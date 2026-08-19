-- Unifica el expediente: tabla oficial = consultas (NOM-004 + paciente_id UUID).
-- Absorbe filas de consultas_medicas (modelo suelto) y elimina esa tabla.
-- Pegar en SQL Editor de Neon y ejecutar. Idempotente.

ALTER TABLE consultas ADD COLUMN IF NOT EXISTS origen_legado TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_consultas_origen_legado
  ON consultas (origen_legado)
  WHERE origen_legado IS NOT NULL;

DO $$
DECLARE
  r record;
  js jsonb;
  nom text;
  partes text[];
  v_nombre text;
  v_ap text;
  v_am text;
  v_nombre_norm text;
  pid uuid;
  origen text;
  v_fecha timestamptz;
  v_estado text;
  exp text;
BEGIN
  IF to_regclass('public.consultas_medicas') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'consultas_medicas'
  ) THEN
    RETURN;
  END IF;

  FOR r IN SELECT * FROM consultas_medicas
  LOOP
    js := to_jsonb(r);
    origen := 'consultas_medicas:' || COALESCE(js->>'id', '');
    IF origen = 'consultas_medicas:' THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM consultas WHERE origen_legado = origen) THEN
      CONTINUE;
    END IF;

    nom := btrim(COALESCE(js->>'paciente_nombre', js->>'nombre_paciente', ''));
    partes := regexp_split_to_array(btrim(nom), '\s+');
    IF coalesce(array_length(partes, 1), 0) = 0 THEN
      v_nombre := 'Paciente'; v_ap := 'Legado'; v_am := '';
    ELSIF array_length(partes, 1) = 1 THEN
      v_nombre := partes[1]; v_ap := 'SIN APELLIDO'; v_am := '';
    ELSIF array_length(partes, 1) = 2 THEN
      v_nombre := partes[1]; v_ap := partes[2]; v_am := '';
    ELSE
      v_nombre := partes[1];
      v_am := partes[array_length(partes, 1)];
      v_ap := array_to_string(partes[2:array_length(partes, 1)-1], ' ');
    END IF;
    v_nombre_norm := btrim(concat_ws(' ', v_nombre, v_ap, nullif(v_am, '')));

    SELECT id INTO pid
    FROM pacientes
    WHERE lower(btrim(concat_ws(' ', nombre, apellido_paterno, nullif(apellido_materno, '')))) = lower(v_nombre_norm)
    LIMIT 1;

    IF pid IS NULL THEN
      exp := 'LEG-CM-' || left(regexp_replace(COALESCE(js->>'id', 'x'), '[^a-zA-Z0-9]', '', 'g'), 12);
      INSERT INTO pacientes (numero_expediente, nombre, apellido_paterno, apellido_materno, fecha_nacimiento)
      VALUES (exp, v_nombre, v_ap, v_am, DATE '1900-01-01')
      ON CONFLICT (numero_expediente) DO UPDATE SET updated_at = NOW()
      RETURNING id INTO pid;
    END IF;

    BEGIN
      v_fecha := COALESCE((js->>'fecha_hora')::timestamptz, (js->>'fecha')::timestamptz, now());
    EXCEPTION WHEN others THEN
      v_fecha := now();
    END;

    v_estado := lower(COALESCE(js->>'estado', 'borrador'));
    IF v_estado NOT IN ('borrador', 'finalizada', 'locked') THEN
      v_estado := 'borrador';
    END IF;

    INSERT INTO consultas (
      paciente_id, fecha_hora, motivo_consulta, exploracion_fisica, diagnostico, tratamiento,
      notas_evolucion, padecimiento_actual, plan, resumen, transcripcion, nota_estructurada,
      receta_paciente_nativo, idioma, especialidad, modelo_whisper, modelo_llm, nombre_archivo,
      estado, medico_nombre, medico_cedula, origen_legado
    ) VALUES (
      pid,
      v_fecha,
      js->>'motivo_consulta',
      js->>'exploracion_fisica',
      js->>'diagnostico',
      COALESCE(js->'tratamiento', '[]'::jsonb),
      js->>'notas_evolucion',
      COALESCE(js->>'padecimiento_actual', js->>'padecimiento'),
      js->>'plan',
      js->>'resumen',
      js->>'transcripcion',
      COALESCE(js->'nota_estructurada', '{}'::jsonb),
      COALESCE(js->'receta_paciente_nativo', js->'receta', '{}'::jsonb),
      COALESCE(js->>'idioma', 'es'),
      js->>'especialidad',
      js->>'modelo_whisper',
      js->>'modelo_llm',
      js->>'nombre_archivo',
      v_estado,
      js->>'medico_nombre',
      js->>'medico_cedula',
      origen
    );
  END LOOP;

  DROP TABLE IF EXISTS consultas_medicas CASCADE;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('2026-08-19-unificar-consultas')
ON CONFLICT (name) DO NOTHING;
