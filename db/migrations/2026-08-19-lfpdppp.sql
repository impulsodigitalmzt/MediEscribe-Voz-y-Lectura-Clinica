-- LFPDPPP: titularidad por médico, consentimiento por consulta, rastro de auditoría.
-- El Worker también aplica esto al arrancar (ensureLfpdppp).

ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS medico_id UUID;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS medico_id UUID;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS consentimiento_informado_aceptado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS consentimiento_informado_en TIMESTAMPTZ;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS consentimiento_informado_titular TEXT NOT NULL DEFAULT '';
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS consentimiento_ia_aceptado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE consultas ADD COLUMN IF NOT EXISTS consentimiento_version TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS ix_pacientes_medico ON pacientes (medico_id);
CREATE INDEX IF NOT EXISTS ix_consultas_medico_fecha ON consultas (medico_id, fecha_hora DESC);

CREATE TABLE IF NOT EXISTS consentimientos_consulta (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consulta_id UUID NOT NULL REFERENCES consultas (id) ON DELETE RESTRICT,
  paciente_id UUID NOT NULL REFERENCES pacientes (id) ON DELETE RESTRICT,
  medico_id UUID NOT NULL,
  tipo TEXT NOT NULL,
  aceptado BOOLEAN NOT NULL,
  titular_nombre TEXT NOT NULL DEFAULT '',
  version_aviso TEXT NOT NULL DEFAULT '',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consentimientos_consulta_tipo_chk CHECK (tipo IN ('informado_consulta', 'procesamiento_ia'))
);

CREATE INDEX IF NOT EXISTS ix_consentimientos_consulta
  ON consentimientos_consulta (consulta_id, created_at DESC);

-- Asigna médico dueño cuando la cédula coincide con users.credentials.
UPDATE consultas c
SET medico_id = u.id
FROM users u
WHERE c.medico_id IS NULL
  AND btrim(COALESCE(u.credentials, '')) <> ''
  AND lower(btrim(u.credentials)) = lower(btrim(COALESCE(c.medico_cedula, '')));

UPDATE pacientes p
SET medico_id = sub.medico_id
FROM (
  SELECT DISTINCT ON (paciente_id) paciente_id, medico_id
  FROM consultas
  WHERE medico_id IS NOT NULL
  ORDER BY paciente_id, fecha_hora ASC
) sub
WHERE p.medico_id IS NULL
  AND p.id = sub.paciente_id;
