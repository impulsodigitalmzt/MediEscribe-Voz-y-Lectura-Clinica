import type { Sql } from "../db.js";

let schemaReady = false;

/**
 * Aplica el esquema relacional pacientes/consultas de forma idempotente.
 * Equivale a db/schema.sql para el arranque del Worker contra Neon.
 */
export async function ensureExpedienteSchema(sql: Sql): Promise<void> {
  if (schemaReady) return;

  const flags = await sql`
    SELECT
      to_regclass('public.users') IS NOT NULL AS has_users,
      to_regclass('public.pacientes') IS NOT NULL AS has_pacientes
  `;
  const existing = (flags[0] ?? {}) as { has_users?: boolean; has_pacientes?: boolean };

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  } catch {
    /* Neon a veces ya trae gen_random_uuid(); no bloquear el arranque */
  }

  if (!existing.has_pacientes) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pacientes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      numero_expediente TEXT NOT NULL,
      nombre TEXT NOT NULL,
      apellido_paterno TEXT NOT NULL,
      apellido_materno TEXT NOT NULL DEFAULT '',
      fecha_nacimiento DATE NOT NULL,
      sexo TEXT NOT NULL DEFAULT '',
      domicilio TEXT NOT NULL DEFAULT '',
      curp TEXT,
      ocupacion TEXT NOT NULL DEFAULT '',
      antecedentes_importantes JSONB NOT NULL DEFAULT '{"alergias":"","cronicos":"","heredo_familiares":"","personales_patologicos":"","personales_no_patologicos":""}'::jsonb,
      consentimiento_privacidad_aceptado BOOLEAN NOT NULL DEFAULT false,
      consentimiento_privacidad_en TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS numero_expediente TEXT`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS sexo TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS domicilio TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS curp TEXT`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS ocupacion TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS antecedentes_importantes JSONB NOT NULL DEFAULT '{"alergias":"","cronicos":"","heredo_familiares":"","personales_patologicos":"","personales_no_patologicos":""}'::jsonb`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS consentimiento_privacidad_aceptado BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS consentimiento_privacidad_en TIMESTAMPTZ`;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_numero_expediente
    ON pacientes (numero_expediente)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pacientes_curp
    ON pacientes (upper(curp))
    WHERE curp IS NOT NULL AND btrim(curp) <> ''
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS ix_pacientes_identidad
    ON pacientes (lower(apellido_paterno), lower(nombre), lower(apellido_materno), fecha_nacimiento)
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_pacientes_nacimiento ON pacientes (fecha_nacimiento)`;

  await sql`
    CREATE TABLE IF NOT EXISTS consultas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      paciente_id UUID NOT NULL REFERENCES pacientes (id) ON DELETE RESTRICT,
      fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      motivo_consulta TEXT,
      exploracion_fisica TEXT,
      diagnostico TEXT,
      tratamiento JSONB NOT NULL DEFAULT '[]'::jsonb,
      notas_evolucion TEXT,
      padecimiento_actual TEXT,
      plan TEXT,
      resumen TEXT,
      transcripcion TEXT,
      nota_estructurada JSONB,
      receta_paciente_nativo JSONB,
      idioma TEXT DEFAULT 'es',
      especialidad TEXT,
      modelo_whisper TEXT,
      modelo_llm TEXT,
      nombre_archivo TEXT,
      estado TEXT NOT NULL DEFAULT 'borrador',
      medico_nombre TEXT,
      medico_cedula TEXT,
      finalizada_en TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT consultas_estado_chk CHECK (estado IN ('borrador', 'finalizada', 'locked'))
    )
  `;

  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS motivo_consulta TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS exploracion_fisica TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS diagnostico TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS tratamiento JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS notas_evolucion TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS padecimiento_actual TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS plan TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS resumen TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS transcripcion TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS nota_estructurada JSONB`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS receta_paciente_nativo JSONB`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS idioma TEXT DEFAULT 'es'`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS especialidad TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS modelo_whisper TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS modelo_llm TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS nombre_archivo TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'borrador'`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS medico_nombre TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS medico_cedula TEXT`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS finalizada_en TIMESTAMPTZ`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;

  await sql`
    CREATE INDEX IF NOT EXISTS ix_consultas_paciente_fecha
    ON consultas (paciente_id, fecha_hora DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS ix_consultas_estado_fecha
    ON consultas (estado, fecha_hora DESC)
  `;

  await sql`ALTER TABLE consultas DROP CONSTRAINT IF EXISTS consultas_estado_chk`;
  try {
    await sql`
      ALTER TABLE consultas
      ADD CONSTRAINT consultas_estado_chk
      CHECK (estado IN ('borrador', 'finalizada', 'locked'))
    `;
  } catch {
    /* ya existe (arranque concurrente) */
  }

  await sql.unsafe(`
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
    $$
  `);

  await sql.unsafe(`DROP TRIGGER IF EXISTS trg_consultas_locked_update ON consultas`);
  try {
    await sql.unsafe(`
      CREATE TRIGGER trg_consultas_locked_update
        BEFORE UPDATE ON consultas
        FOR EACH ROW
        EXECUTE PROCEDURE impedir_mutacion_consulta_locked()
    `);
  } catch {
    /* trigger ya existe */
  }
  await sql.unsafe(`DROP TRIGGER IF EXISTS trg_consultas_locked_delete ON consultas`);
  try {
    await sql.unsafe(`
      CREATE TRIGGER trg_consultas_locked_delete
        BEFORE DELETE ON consultas
        FOR EACH ROW
        EXECUTE PROCEDURE impedir_mutacion_consulta_locked()
    `);
  } catch {
    /* trigger ya existe */
  }

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id TEXT,
      actor_id TEXT,
      actor_nombre TEXT,
      actor_rol TEXT,
      accion TEXT NOT NULL,
      recurso TEXT NOT NULL,
      entidad_afectada_id UUID,
      recurso_id UUID,
      metodo TEXT NOT NULL DEFAULT '',
      ruta TEXT NOT NULL DEFAULT '',
      status_code INTEGER,
      ip TEXT,
      user_agent TEXT
    )
  `;
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entidad_afectada_id UUID`;
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS ix_audit_logs_created ON audit_logs (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_audit_logs_recurso ON audit_logs (recurso, recurso_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_audit_logs_actor ON audit_logs (actor_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_audit_logs_user ON audit_logs (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_audit_logs_entidad ON audit_logs (entidad_afectada_id, created_at DESC)`;

  } // !has_pacientes

  await ensureNotasAclaracion(sql);
  await migrarConsultasMedicasLegacy(sql);

  if (existing.has_users && existing.has_pacientes) {
    schemaReady = true;
    return;
  }

  if (existing.has_users) {
    schemaReady = true;
    return;
  }

  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS accion TEXT`;
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS recurso TEXT`;

  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_users_email ON users (email)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_users_whatsapp_phone ON users (whatsapp_phone)`;

  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_encounters_physician_status ON encounters (physician_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_encounters_encounter_id ON encounters (encounter_id)`;

  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_transcripts_encounter_seq ON transcripts (encounter_id, sequence_number)`;

  await sql`
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
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS note_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      note_id UUID NOT NULL REFERENCES clinical_notes (id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content_snapshot JSONB NOT NULL,
      change_description TEXT NOT NULL DEFAULT '',
      edited_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_note_versions_note_version ON note_versions (note_id, version_number)`;

  await sql`
    CREATE TABLE IF NOT EXISTS consent_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id UUID NOT NULL REFERENCES encounters (id) ON DELETE CASCADE,
      consent_type TEXT NOT NULL DEFAULT 'recording',
      consented BOOLEAN NOT NULL,
      consented_by TEXT NOT NULL DEFAULT '',
      recorded_by UUID NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wa_message_id TEXT UNIQUE,
      from_phone TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      encounter_id UUID REFERENCES encounters (id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    INSERT INTO schema_migrations (name)
    VALUES ('2026-08-16-compliance-normativo')
    ON CONFLICT (name) DO NOTHING
  `;
  await sql`
    INSERT INTO schema_migrations (name)
    VALUES ('2026-08-16-neon-auth-encounters')
    ON CONFLICT (name) DO NOTHING
  `;
  await sql`
    INSERT INTO schema_migrations (name)
    VALUES ('2026-08-16-notas-aclaracion-nom004')
    ON CONFLICT (name) DO NOTHING
  `;

  schemaReady = true;
}

/** Notas de aclaración NOM-004 5.11: se aplica aunque pacientes/users ya existan. */
async function ensureNotasAclaracion(sql: Sql): Promise<void> {
  const flags = await sql`
    SELECT
      to_regclass('public.consultas') IS NOT NULL AS has_consultas,
      to_regclass('public.notas_aclaracion') IS NOT NULL AS has_aclaraciones
  `;
  const existing = (flags[0] ?? {}) as { has_consultas?: boolean; has_aclaraciones?: boolean };
  if (!existing.has_consultas) return;

  await sql`
    CREATE TABLE IF NOT EXISTS notas_aclaracion (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      consulta_id UUID NOT NULL REFERENCES consultas (id) ON DELETE RESTRICT,
      paciente_id UUID NOT NULL REFERENCES pacientes (id) ON DELETE RESTRICT,
      tipo TEXT NOT NULL DEFAULT 'aclaracion',
      motivo TEXT NOT NULL,
      contenido TEXT NOT NULL,
      medico_nombre TEXT NOT NULL DEFAULT '',
      medico_cedula TEXT NOT NULL DEFAULT '',
      medico_especialidad TEXT NOT NULL DEFAULT '',
      sello_responsable TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'borrador',
      locked_en TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT notas_aclaracion_tipo_chk CHECK (tipo IN ('aclaracion', 'rectificacion')),
      CONSTRAINT notas_aclaracion_estado_chk CHECK (estado IN ('borrador', 'locked', 'finalizada'))
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_notas_aclaracion_consulta ON notas_aclaracion (consulta_id, created_at ASC)`;
  await sql`CREATE INDEX IF NOT EXISTS ix_notas_aclaracion_paciente ON notas_aclaracion (paciente_id, created_at DESC)`;

  await sql.unsafe(`
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
    $$
  `);

  await sql.unsafe(`DROP TRIGGER IF EXISTS trg_aclaracion_locked_update ON notas_aclaracion`);
  try {
    await sql.unsafe(`
      CREATE TRIGGER trg_aclaracion_locked_update
        BEFORE UPDATE ON notas_aclaracion
        FOR EACH ROW
        EXECUTE PROCEDURE impedir_mutacion_consulta_locked()
    `);
  } catch {
    /* trigger ya existe */
  }
  await sql.unsafe(`DROP TRIGGER IF EXISTS trg_aclaracion_locked_delete ON notas_aclaracion`);
  try {
    await sql.unsafe(`
      CREATE TRIGGER trg_aclaracion_locked_delete
        BEFORE DELETE ON notas_aclaracion
        FOR EACH ROW
        EXECUTE PROCEDURE impedir_mutacion_consulta_locked()
    `);
  } catch {
    /* trigger ya existe */
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO schema_migrations (name)
      VALUES ('2026-08-16-notas-aclaracion-nom004')
      ON CONFLICT (name) DO NOTHING
    `;
  } catch {
    /* sin tabla de migraciones no bloquea la consulta */
  }
}

function textoJson(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asJsonValue(value: unknown, fallback: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function partirNombreLegado(completo: string): { nombre: string; apellidoPaterno: string; apellidoMaterno: string } {
  const partes = completo.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { nombre: "Paciente", apellidoPaterno: "Legado", apellidoMaterno: "" };
  if (partes.length === 1) return { nombre: partes[0], apellidoPaterno: "SIN APELLIDO", apellidoMaterno: "" };
  if (partes.length === 2) return { nombre: partes[0], apellidoPaterno: partes[1], apellidoMaterno: "" };
  return {
    nombre: partes[0],
    apellidoPaterno: partes.slice(1, -1).join(" "),
    apellidoMaterno: partes[partes.length - 1],
  };
}

/**
 * La tabla oficial NOM-004 es `consultas` (UUID + paciente_id + nota estructurada).
 * `consultas_medicas` es el modelo suelto anterior (id serial, nombre en texto).
 * Se absorbe y se elimina para que lectura y guardado usen el mismo sitio.
 */
async function migrarConsultasMedicasLegacy(sql: Sql): Promise<void> {
  try {
    await migrarConsultasMedicasLegacyInner(sql);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "migrate_consultas_medicas_failed",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
  }
}

async function migrarConsultasMedicasLegacyInner(sql: Sql): Promise<void> {
  const flags = await sql<{ has_legacy: boolean; is_view: boolean }[]>`
    SELECT
      to_regclass('public.consultas_medicas') IS NOT NULL AS has_legacy,
      EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'consultas_medicas'
      ) AS is_view
  `;
  const meta = flags[0];
  if (!meta?.has_legacy || meta.is_view) return;

  await sql`ALTER TABLE consultas ADD COLUMN IF NOT EXISTS origen_legado TEXT`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_consultas_origen_legado
    ON consultas (origen_legado)
    WHERE origen_legado IS NOT NULL
  `;

  const legacy = await sql<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(cm) AS row FROM consultas_medicas cm
  `;
  let migrated = 0;
  let failed = 0;

  for (const item of legacy) {
    try {
    const row = item.row ?? {};
    const origen = `consultas_medicas:${String(row.id ?? "")}`;
    if (!row.id) continue;
    const already = await sql<{ id: string }[]>`
      SELECT id FROM consultas WHERE origen_legado = ${origen} LIMIT 1
    `;
    if (already[0]) continue;

    const nombreCompleto = textoJson(row, "paciente_nombre", "nombre_paciente", "paciente");
    const partes = partirNombreLegado(nombreCompleto || "Paciente Legado");
    const nombreNorm = `${partes.nombre} ${partes.apellidoPaterno} ${partes.apellidoMaterno}`.replace(/\s+/g, " ").trim();

    let pacienteId = "";
    const encontrados = await sql<{ id: string }[]>`
      SELECT id
      FROM pacientes
      WHERE lower(btrim(concat_ws(' ', nombre, apellido_paterno, nullif(apellido_materno, '')))) = lower(${nombreNorm})
      LIMIT 1
    `;
    if (encontrados[0]) {
      pacienteId = String(encontrados[0].id);
    } else {
      const expediente = `LEG-CM-${String(row.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
      const created = await sql<{ id: string }[]>`
        INSERT INTO pacientes (
          numero_expediente, nombre, apellido_paterno, apellido_materno, fecha_nacimiento
        ) VALUES (
          ${expediente},
          ${partes.nombre},
          ${partes.apellidoPaterno},
          ${partes.apellidoMaterno},
          DATE '1900-01-01'
        )
        ON CONFLICT (numero_expediente) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;
      pacienteId = String(created[0]?.id ?? "");
    }
    if (!pacienteId) continue;

    const fechaRaw = row.fecha_hora ?? row.fecha ?? row.created_at;
    const parsedFecha = fechaRaw ? new Date(String(fechaRaw)) : new Date();
    const fechaHora = Number.isNaN(parsedFecha.getTime()) ? new Date() : parsedFecha;
    const nota = asJsonValue(row.nota_estructurada, {});
    const receta = asJsonValue(row.receta_paciente_nativo ?? row.receta, {});
    const tratamiento = asJsonValue(row.tratamiento, []);
    const estadoRaw = textoJson(row, "estado").toLowerCase();
    const estado = estadoRaw === "locked" || estadoRaw === "finalizada" ? estadoRaw : "borrador";

    await sql`
      INSERT INTO consultas (
        paciente_id, fecha_hora, motivo_consulta, exploracion_fisica, diagnostico, tratamiento,
        notas_evolucion, padecimiento_actual, plan, resumen, transcripcion, nota_estructurada,
        receta_paciente_nativo, idioma, especialidad, modelo_whisper, modelo_llm, nombre_archivo,
        estado, medico_nombre, medico_cedula, origen_legado
      ) VALUES (
        ${pacienteId}::uuid,
        ${fechaHora.toISOString()}::timestamptz,
        ${textoJson(row, "motivo_consulta")},
        ${textoJson(row, "exploracion_fisica")},
        ${textoJson(row, "diagnostico")},
        ${sql.json(tratamiento)},
        ${textoJson(row, "notas_evolucion")},
        ${textoJson(row, "padecimiento_actual", "padecimiento")},
        ${textoJson(row, "plan")},
        ${textoJson(row, "resumen")},
        ${textoJson(row, "transcripcion")},
        ${sql.json(nota)},
        ${sql.json(receta)},
        ${textoJson(row, "idioma") || "es"},
        ${textoJson(row, "especialidad")},
        ${textoJson(row, "modelo_whisper")},
        ${textoJson(row, "modelo_llm")},
        ${textoJson(row, "nombre_archivo")},
        ${estado},
        ${textoJson(row, "medico_nombre")},
        ${textoJson(row, "medico_cedula")},
        ${origen}
      )
    `;
    migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "migrate_consultas_medicas_row_failed",
          message: error instanceof Error ? error.message : "unknown",
        })
      );
    }
  }

  if (failed === 0) {
    await sql`DROP TABLE IF EXISTS consultas_medicas CASCADE`;
  }
  try {
    await sql`
      INSERT INTO schema_migrations (name)
      VALUES ('2026-08-19-unificar-consultas')
      ON CONFLICT (name) DO NOTHING
    `;
  } catch {
    /* ignore */
  }
  console.log(
    JSON.stringify({
      event: "migrated_consultas_medicas",
      rowsRead: legacy.length,
      rowsInserted: migrated,
      rowsFailed: failed,
      dropped: failed === 0,
      officialTable: "consultas",
    })
  );
}
