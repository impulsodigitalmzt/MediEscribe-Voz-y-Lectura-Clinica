import type { Sql } from "../db.js";

let schemaReady = false;

/**
 * Aplica el esquema relacional pacientes/consultas de forma idempotente.
 * Equivale a db/schema.sql para el arranque del Worker contra Neon.
 */
export async function ensureExpedienteSchema(sql: Sql): Promise<void> {
  if (schemaReady) return;

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  } catch {
    /* Neon a veces ya trae gen_random_uuid(); no bloquear el arranque */
  }

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

  await sql`
    INSERT INTO schema_migrations (name)
    VALUES ('2026-08-16-compliance-normativo')
    ON CONFLICT (name) DO NOTHING
  `;
  await sql`
    INSERT INTO schema_migrations (name)
    VALUES ('2026-08-16-notas-aclaracion-nom004')
    ON CONFLICT (name) DO NOTHING
  `;

  schemaReady = true;
}
