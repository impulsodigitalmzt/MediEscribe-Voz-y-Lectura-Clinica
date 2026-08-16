-- =============================================================================
-- MediEscribe — Expediente clínico relacional (Neon / PostgreSQL)
-- Continuidad médica: pacientes (maestro) 1:N consultas (episodios)
-- Alineado a NOM-004-SSA3-2012 (ver NOM004_REQUIREMENTS.md)
--
-- Aplicar en Neon SQL Editor o: psql "$DATABASE_URL" -f db/schema.sql
-- El Worker también aplica este esquema de forma idempotente al arrancar.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- PACIENTES — datos maestros que NO cambian en cada consulta
-- NOM-004 4.4  expediente único por paciente
-- NOM-004 5.2.3 nombre, sexo, edad, domicilio
-- NOM-004 5.9   nombre completo, edad, sexo y número de expediente
-- NOM-004 5.14  un solo expediente por paciente en el establecimiento
-- NOM-004 6.1.1 ficha de identificación
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pacientes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_expediente     TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  apellido_paterno      TEXT NOT NULL,
  apellido_materno      TEXT NOT NULL DEFAULT '',
  fecha_nacimiento      DATE NOT NULL,
  sexo                  TEXT NOT NULL DEFAULT '',
  domicilio             TEXT NOT NULL DEFAULT '',
  curp                  TEXT,
  ocupacion             TEXT NOT NULL DEFAULT '',
  -- alergias, crónicos, heredo-familiares y patológicos (NOM-004 6.1.1)
  antecedentes_importantes JSONB NOT NULL DEFAULT jsonb_build_object(
    'alergias', '',
    'cronicos', '',
    'heredo_familiares', '',
    'personales_patologicos', '',
    'personales_no_patologicos', ''
  ),
  consentimiento_privacidad_aceptado BOOLEAN NOT NULL DEFAULT false,
  consentimiento_privacidad_en TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pacientes_nombre_chk CHECK (btrim(nombre) <> ''),
  CONSTRAINT pacientes_apellido_paterno_chk CHECK (btrim(apellido_paterno) <> '')
);

ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS consentimiento_privacidad_aceptado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS consentimiento_privacidad_en TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_numero_expediente
  ON pacientes (numero_expediente);

-- Identificación única nacional cuando el CURP está presente (18 caracteres).
CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_curp
  ON pacientes (upper(curp))
  WHERE curp IS NOT NULL AND btrim(curp) <> '';

-- Desambiguación de homónimos: nombre + apellidos + fecha de nacimiento.
CREATE INDEX IF NOT EXISTS ix_pacientes_identidad
  ON pacientes (
    lower(apellido_paterno),
    lower(nombre),
    lower(apellido_materno),
    fecha_nacimiento
  );

CREATE INDEX IF NOT EXISTS ix_pacientes_nacimiento
  ON pacientes (fecha_nacimiento);

-- -----------------------------------------------------------------------------
-- CONSULTAS — episodios clínicos (notas de evolución / consulta)
-- NOM-004 5.10  fecha, hora y autor
-- NOM-004 6.2   nota de evolución del paciente ambulatorio
-- NOM-004 6.1.2 exploración física
-- NOM-004 6.1.4 diagnóstico
-- NOM-004 6.2.6 tratamiento (dosis, vía, periodicidad)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id           UUID NOT NULL REFERENCES pacientes (id) ON DELETE RESTRICT,
  fecha_hora            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  motivo_consulta       TEXT,
  exploracion_fisica    TEXT,
  diagnostico           TEXT,
  tratamiento           JSONB NOT NULL DEFAULT '[]'::jsonb,
  notas_evolucion       TEXT,
  padecimiento_actual   TEXT,
  plan                  TEXT,
  resumen               TEXT,
  transcripcion         TEXT,
  nota_estructurada     JSONB,
  receta_paciente_nativo JSONB,
  idioma                TEXT DEFAULT 'es',
  especialidad          TEXT,
  modelo_whisper        TEXT,
  modelo_llm            TEXT,
  nombre_archivo        TEXT,
  estado                TEXT NOT NULL DEFAULT 'borrador',
  medico_nombre         TEXT,
  medico_cedula         TEXT,
  finalizada_en         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consultas_estado_chk CHECK (estado IN ('borrador', 'finalizada', 'locked'))
);

ALTER TABLE consultas DROP CONSTRAINT IF EXISTS consultas_estado_chk;
ALTER TABLE consultas ADD CONSTRAINT consultas_estado_chk
  CHECK (estado IN ('borrador', 'finalizada', 'locked'));

-- Cierre inmutable: ningún UPDATE/DELETE sobre registros locked (o finalizada legado).
-- El UPDATE de cierre sí se permite porque OLD.estado sigue siendo 'borrador'.
CREATE OR REPLACE FUNCTION impedir_mutacion_consulta_locked()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado IN ('locked', 'finalizada') THEN
    RAISE EXCEPTION 'La consulta está locked y no puede alterarse (NOM-004-SSA3-2012).'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consultas_locked_update ON consultas;
CREATE TRIGGER trg_consultas_locked_update
  BEFORE UPDATE ON consultas
  FOR EACH ROW
  EXECUTE PROCEDURE impedir_mutacion_consulta_locked();

DROP TRIGGER IF EXISTS trg_consultas_locked_delete ON consultas;
CREATE TRIGGER trg_consultas_locked_delete
  BEFORE DELETE ON consultas
  FOR EACH ROW
  EXECUTE PROCEDURE impedir_mutacion_consulta_locked();

-- Bitácora de acceso y modificación de expedientes
CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id       TEXT,
  actor_id      TEXT,
  actor_nombre  TEXT,
  actor_rol     TEXT,
  accion        TEXT NOT NULL,
  recurso       TEXT NOT NULL,
  entidad_afectada_id UUID,
  recurso_id    UUID,
  metodo        TEXT NOT NULL DEFAULT '',
  ruta          TEXT NOT NULL DEFAULT '',
  status_code   INTEGER,
  ip            TEXT,
  user_agent    TEXT
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entidad_afectada_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_recurso ON audit_logs (recurso, recurso_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_entidad ON audit_logs (entidad_afectada_id, created_at DESC);

-- Notas de aclaración / rectificación (NOM-004 5.11): no alteran la nota locked.
CREATE TABLE IF NOT EXISTS notas_aclaracion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id           UUID NOT NULL REFERENCES consultas (id) ON DELETE RESTRICT,
  paciente_id           UUID NOT NULL REFERENCES pacientes (id) ON DELETE RESTRICT,
  tipo                  TEXT NOT NULL DEFAULT 'aclaracion',
  motivo                TEXT NOT NULL,
  contenido             TEXT NOT NULL,
  medico_nombre         TEXT NOT NULL DEFAULT '',
  medico_cedula         TEXT NOT NULL DEFAULT '',
  medico_especialidad   TEXT NOT NULL DEFAULT '',
  sello_responsable     TEXT NOT NULL DEFAULT '',
  estado                TEXT NOT NULL DEFAULT 'borrador',
  locked_en             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notas_aclaracion_tipo_chk CHECK (tipo IN ('aclaracion', 'rectificacion')),
  CONSTRAINT notas_aclaracion_estado_chk CHECK (estado IN ('borrador', 'locked', 'finalizada'))
);

CREATE INDEX IF NOT EXISTS ix_notas_aclaracion_consulta
  ON notas_aclaracion (consulta_id, created_at ASC);
CREATE INDEX IF NOT EXISTS ix_notas_aclaracion_paciente
  ON notas_aclaracion (paciente_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_aclaracion_locked_update ON notas_aclaracion;
CREATE TRIGGER trg_aclaracion_locked_update
  BEFORE UPDATE ON notas_aclaracion
  FOR EACH ROW
  EXECUTE PROCEDURE impedir_mutacion_consulta_locked();

DROP TRIGGER IF EXISTS trg_aclaracion_locked_delete ON notas_aclaracion;
CREATE TRIGGER trg_aclaracion_locked_delete
  BEFORE DELETE ON notas_aclaracion
  FOR EACH ROW
  EXECUTE PROCEDURE impedir_mutacion_consulta_locked();

INSERT INTO schema_migrations (name)
VALUES ('2026-08-16-compliance-normativo')
ON CONFLICT (name) DO NOTHING;

INSERT INTO schema_migrations (name)
VALUES ('2026-08-16-notas-aclaracion-nom004')
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- AUTH + ENCOUNTERS (antes en Supabase; ahora solo Neon)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  credentials TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT 'General Practice',
  institution TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'physician'
    CHECK (role IN ('physician', 'nurse', 'admin', 'system')),
  preferred_language TEXT NOT NULL DEFAULT 'es',
  preferred_template TEXT NOT NULL DEFAULT 'general_practice',
  whatsapp_phone TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_whatsapp_phone ON users (whatsapp_phone);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id TEXT UNIQUE NOT NULL,
  physician_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL DEFAULT '',
  patient_dob TEXT NOT NULL DEFAULT '',
  patient_mrn TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN (
      'recording', 'paused', 'transcribing', 'generating_note',
      'pending_review', 'signed_off', 'amended'
    )),
  specialty_template TEXT NOT NULL DEFAULT 'general_practice',
  encounter_type TEXT NOT NULL DEFAULT 'regular',
  spoken_language TEXT NOT NULL DEFAULT 'es',
  output_language TEXT NOT NULL DEFAULT 'es',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  consent_recorded BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'whatsapp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_off_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_encounters_physician_status ON encounters (physician_id, status);
CREATE INDEX IF NOT EXISTS ix_encounters_encounter_id ON encounters (encounter_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  speaker_label TEXT NOT NULL DEFAULT 'unknown',
  content TEXT NOT NULL,
  timestamp_start DOUBLE PRECISION NOT NULL DEFAULT 0,
  timestamp_end DOUBLE PRECISION NOT NULL DEFAULT 0,
  language_detected TEXT NOT NULL DEFAULT 'es',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_transcripts_encounter_seq ON transcripts (encounter_id, sequence_number);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID UNIQUE NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'signed_off', 'locked', 'amended')),
  chief_complaint TEXT NOT NULL DEFAULT '',
  hpi TEXT NOT NULL DEFAULT '',
  on_direct_questioning TEXT NOT NULL DEFAULT '',
  past_medical_history TEXT NOT NULL DEFAULT '',
  past_surgical_history TEXT NOT NULL DEFAULT '',
  drug_history TEXT NOT NULL DEFAULT '',
  medications TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  family_history TEXT NOT NULL DEFAULT '',
  social_history TEXT NOT NULL DEFAULT '',
  nutritional_history TEXT NOT NULL DEFAULT '',
  immunization_history TEXT NOT NULL DEFAULT '',
  developmental_history TEXT NOT NULL DEFAULT '',
  gynecological_history TEXT NOT NULL DEFAULT '',
  obstetric_history TEXT NOT NULL DEFAULT '',
  review_of_systems JSONB NOT NULL DEFAULT '{}'::jsonb,
  physical_examination JSONB NOT NULL DEFAULT '{}'::jsonb,
  lab_investigations TEXT NOT NULL DEFAULT '',
  imaging_investigations TEXT NOT NULL DEFAULT '',
  investigation_comments TEXT NOT NULL DEFAULT '',
  provisional_diagnosis TEXT NOT NULL DEFAULT '',
  differential_diagnosis TEXT NOT NULL DEFAULT '',
  final_diagnosis TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  recommended_plan TEXT NOT NULL DEFAULT '',
  sbar_summary TEXT NOT NULL DEFAULT '',
  primary_survey TEXT NOT NULL DEFAULT '',
  secondary_survey TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  missing_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertain_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_generated BOOLEAN NOT NULL DEFAULT true,
  ai_disclaimer TEXT NOT NULL DEFAULT
    'This note was generated by AI and requires physician review before finalization.',
  current_version INTEGER NOT NULL DEFAULT 1,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_off_at TIMESTAMPTZ,
  signed_off_by UUID
);

CREATE TABLE IF NOT EXISTS note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES clinical_notes (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content_snapshot JSONB NOT NULL,
  change_description TEXT NOT NULL DEFAULT '',
  edited_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_note_versions_note_version ON note_versions (note_id, version_number);

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL DEFAULT 'recording',
  consented BOOLEAN NOT NULL,
  consented_by TEXT NOT NULL DEFAULT '',
  recorded_by UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id TEXT UNIQUE,
  from_phone TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  encounter_id UUID REFERENCES encounters (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name)
VALUES ('2026-08-16-neon-auth-encounters')
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_consultas_paciente_fecha
  ON consultas (paciente_id, fecha_hora DESC);

CREATE INDEX IF NOT EXISTS ix_consultas_estado_fecha
  ON consultas (estado, fecha_hora DESC);

-- -----------------------------------------------------------------------------
-- Migración opcional desde el modelo aislado consultas_medicas (notas sueltas).
-- No se ejecuta automáticamente: los nombres sueltos no bastan para un
-- expediente NOM-004. Revisar homónimos a mano antes de correr este bloque.
-- -----------------------------------------------------------------------------
-- INSERT INTO pacientes (numero_expediente, nombre, apellido_paterno, apellido_materno, fecha_nacimiento)
-- SELECT
--   'LEG-' || lpad(min(id)::text, 8, '0'),
--   split_part(min(paciente_nombre), ' ', 1),
--   COALESCE(nullif(split_part(min(paciente_nombre), ' ', 2), ''), 'SIN APELLIDO'),
--   COALESCE(nullif(split_part(min(paciente_nombre), ' ', 3), ''), ''),
--   DATE '1900-01-01'
-- FROM consultas_medicas
-- GROUP BY lower(btrim(paciente_nombre));
