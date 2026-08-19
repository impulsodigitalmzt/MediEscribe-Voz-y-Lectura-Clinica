-- Neon: notas de aclaración / rectificación (NOM-004-SSA3-2012, numeral 5.11).
-- Pegar en SQL Editor de Neon y ejecutar. Idempotente.

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

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name)
VALUES ('2026-08-16-notas-aclaracion-nom004')
ON CONFLICT (name) DO NOTHING;
