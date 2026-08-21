import type { NotaClinica, SignosVitales } from '../types';
import { vacioSignosVitales } from '../types';

const PROPIEDADES_TEXTO = [
  'text', 'texto', 'descripcion', 'descripción', 'contenido', 'content',
  'value', 'valor', 'narrative', 'narrativa', 'resumen',
  'motivo_consulta', 'motivo', 'padecimiento_actual', 'padecimiento',
  'subjetivo', 'chief_complaint', 'hpi', 'objetivo', 'exploracion_fisica',
  'analisis', 'análisis', 'diagnostico', 'plan', 'plan_tratamiento',
] as const;

const CAMPOS_STRING_NOTA: Array<keyof NotaClinica> = [
  'nombre_paciente', 'edad', 'sexo', 'domicilio', 'ocupacion', 'fecha', 'hora',
  'medico_nombre', 'medico_cedula', 'medico_especialidad',
  'motivo_consulta', 'padecimiento_actual', 'interrogatorio',
  'antecedentes_personales', 'antecedentes_quirurgicos', 'medicamentos', 'alergias',
  'antecedentes_familiares', 'antecedentes_sociales', 'exploracion_fisica', 'estudios',
  'diagnostico_presuntivo', 'diagnosticos_diferenciales', 'diagnostico', 'diagnostico_cie10',
  'pronostico', 'plan', 'seguimiento', 'notas_evolucion', 'resumen',
  'subjetivo', 'objetivo', 'analisis', 'sello_responsable',
];

function asTexto(value: unknown, depth = 0): string {
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean' || typeof value === 'function') return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || text === '[object Object]' || /^\[(?:NO MENCIONADO|NOT DISCUSSED)\]$/i.test(text)) return '';
    return text;
  }
  if (depth > 5) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>;
          const meds = [row.medicamento ?? row.nombre, row.dosis, row.via ?? row['vía'], row.periodicidad ?? row.frecuencia]
            .filter((part) => typeof part === 'string' && part.trim())
            .join(' ');
          return meds || asTexto(item, depth + 1);
        }
        return asTexto(item, depth + 1);
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of PROPIEDADES_TEXTO) {
      if (!(key in row)) continue;
      const extracted = asTexto(row[key], depth + 1);
      if (extracted) return extracted;
    }
    return Object.values(row).map((item) => asTexto(item, depth + 1)).filter(Boolean).join(' ').trim();
  }
  return '';
}

/** Garantiza que los campos SOAP del estado React sean strings planos. */
export function asegurarNotaStrings(nota: NotaClinica): NotaClinica {
  const next = { ...nota };
  for (const key of CAMPOS_STRING_NOTA) {
    (next[key] as string) = asTexto(next[key]);
  }
  if (!next.signos_vitales || typeof next.signos_vitales !== 'object') {
    next.signos_vitales = vacioSignosVitales();
  }
  if (!Array.isArray(next.solicitudes_estudio)) next.solicitudes_estudio = [];
  if (!Array.isArray(next.tratamiento)) next.tratamiento = [];
  if (!Array.isArray(next.campos_inciertos)) next.campos_inciertos = [];
  if (!Array.isArray(next.secciones_faltantes)) next.secciones_faltantes = [];
  return next;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function campoSigno(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function calcularImc(peso: string, talla: string): string {
  const kg = Number.parseFloat(peso.replace(',', '.'));
  const cm = Number.parseFloat(talla.replace(',', '.'));
  if (!Number.isFinite(kg) || !Number.isFinite(cm) || kg <= 0 || cm <= 0) return '';
  const metros = cm > 3 ? cm / 100 : cm;
  if (metros <= 0) return '';
  return (kg / (metros * metros)).toFixed(2);
}

function parseSignos(raw: Record<string, unknown>, base: SignosVitales): SignosVitales {
  const source = asObject(raw.signos_vitales) ?? asObject(raw.vitales) ?? {};
  const next = { ...vacioSignosVitales(), ...base };
  next.ta_sistolica = campoSigno(source, 'ta_sistolica', 'ta_sis', 'sistolica') || next.ta_sistolica;
  next.ta_diastolica = campoSigno(source, 'ta_diastolica', 'ta_dia', 'diastolica') || next.ta_diastolica;
  next.temperatura = campoSigno(source, 'temperatura', 'temp') || next.temperatura;
  next.fc = campoSigno(source, 'fc', 'frecuencia_cardiaca', 'pulso') || next.fc;
  next.fr = campoSigno(source, 'fr', 'frecuencia_respiratoria') || next.fr;
  next.spo2 = campoSigno(source, 'spo2', 'saturacion', 'sat') || next.spo2;
  next.peso = campoSigno(source, 'peso', 'weight') || next.peso;
  next.talla = campoSigno(source, 'talla', 'estatura', 'altura') || next.talla;
  next.glucosa = campoSigno(source, 'glucosa', 'glucose') || next.glucosa;
  next.imc = campoSigno(source, 'imc', 'bmi') || calcularImc(next.peso, next.talla) || next.imc;
  return next;
}

function parseSolicitudes(raw: Record<string, unknown>, fallback: string[]): string[] {
  const value = raw.solicitudes_estudio ?? raw.estudios_solicitados;
  if (Array.isArray(value)) {
    const items = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    if (items.length) return items;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}

function diagnosticoConCie10(raw: Record<string, unknown>): { diagnostico: string; cie10: string } {
  const diagnostico = asTexto(raw.diagnostico) || asTexto(raw.diagnóstico);
  const cie =
    asTexto(raw.diagnostico_cie10) ||
    asTexto(raw.cie10) ||
    asTexto(raw.cie_10) ||
    asTexto(raw.codigo_cie10);
  const fromDx = diagnostico.match(/CIE-?10\s*:?\s*([A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?)/i)?.[1];
  const codigo = (cie.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?/i)?.[0] || fromDx || '').toUpperCase();
  if (!diagnostico) return { diagnostico: '', cie10: codigo };
  if (!codigo || /cie-?10/i.test(diagnostico) || diagnostico.includes(codigo)) {
    return { diagnostico, cie10: codigo };
  }
  return { diagnostico: `${diagnostico} (CIE-10: ${codigo})`, cie10: codigo };
}

function aplanarSoap(raw: Record<string, unknown>): Record<string, unknown> {
  const soap = asObject(raw.soap);
  if (!soap) return raw;
  const next = { ...raw };
  const subjetivo = asTexto(soap.subjetivo);
  const objetivo = asTexto(soap.objetivo);
  const analisis = asTexto(soap.analisis) || asTexto(soap.análisis);
  const plan = asTexto(soap.plan);
  if (!asTexto(next.padecimiento_actual) && subjetivo) next.padecimiento_actual = subjetivo;
  if (!asTexto(next.motivo_consulta) && subjetivo) {
    next.motivo_consulta = (subjetivo.split(/[.!?]/)[0] || subjetivo).slice(0, 220);
  }
  if (!asTexto(next.exploracion_fisica) && objetivo) next.exploracion_fisica = objetivo;
  if (!asTexto(next.diagnostico) && analisis) next.diagnostico = analisis;
  if (!asTexto(next.plan) && !asTexto(next.plan_tratamiento) && plan) next.plan = plan;
  return next;
}

export function notaClinicaVacia(): NotaClinica {
  return {
    nombre_paciente: '', edad: '', sexo: '', domicilio: '', ocupacion: '',
    fecha: '', hora: '', medico_nombre: '', medico_cedula: '', medico_especialidad: '',
    motivo_consulta: '', padecimiento_actual: '', interrogatorio: '',
    antecedentes_personales: '', antecedentes_quirurgicos: '', medicamentos: '',
    alergias: '', antecedentes_familiares: '', antecedentes_sociales: '',
    exploracion_fisica: '', signos_vitales: vacioSignosVitales(), estudios: '',
    solicitudes_estudio: [], diagnostico_presuntivo: '', diagnosticos_diferenciales: '',
    diagnostico: '', diagnostico_cie10: '', pronostico: '', plan: '',
    tratamiento: [], seguimiento: '', notas_evolucion: '', resumen: '',
    subjetivo: '', objetivo: '', analisis: '',
    campos_inciertos: [], secciones_faltantes: [], sello_responsable: '',
  };
}

export function transcripcionPlana(value: unknown): string {
  return asTexto(value);
}

/**
 * Extrae el contrato SOAP (solo strings) desde la respuesta del Worker.
 * No copia el borrador. Si Groq no trajo clínica, el campo queda "".
 */
export function extraerSoapDesdeRespuesta(
  result: {
    nota?: Partial<NotaClinica> | Record<string, unknown> | null;
    soap?: Record<string, unknown> | null;
    consulta?: { nota_estructurada?: Partial<NotaClinica> | Record<string, unknown> | null } | null;
  } | null | undefined,
): Pick<NotaClinica, 'motivo_consulta' | 'padecimiento_actual' | 'subjetivo' | 'objetivo' | 'analisis' | 'plan'> {
  const notaRaw = (result?.nota ?? result?.consulta?.nota_estructurada ?? {}) as Record<string, unknown>;
  const nestedNota = (asObject(notaRaw.nota_medica_espanol) ?? asObject(notaRaw.nota) ?? notaRaw) as Record<string, unknown>;
  const soap = asObject(nestedNota.soap) ?? asObject(result?.soap) ?? {};
  const plano = { ...nestedNota, ...soap };
  const motivo = asTexto(plano.motivo_consulta);
  const padecimiento = asTexto(plano.padecimiento_actual);
  return {
    motivo_consulta: motivo,
    padecimiento_actual: padecimiento,
    subjetivo: asTexto(plano.subjetivo) || padecimiento,
    objetivo: asTexto(plano.objetivo),
    analisis: asTexto(plano.analisis),
    plan: asTexto(plano.plan) || asTexto(plano.plan_tratamiento),
  };
}

/**
 * Asigna el JSON clínico (SOAP / NOM-004) a los campos del editor.
 */
export function mapearNotaDesdeIA(
  incoming: Partial<NotaClinica> | Record<string, unknown> | null | undefined,
  base: NotaClinica,
): NotaClinica {
  if (!incoming || typeof incoming !== 'object') return base;
  const raw = aplanarSoap(incoming as Record<string, unknown>);
  const mapped: NotaClinica = {
    ...base,
    signos_vitales: parseSignos(raw, base.signos_vitales ?? vacioSignosVitales()),
    solicitudes_estudio: parseSolicitudes(raw, base.solicitudes_estudio ?? []),
  };

  mapped.motivo_consulta = asTexto(raw.motivo_consulta);
  mapped.padecimiento_actual = asTexto(raw.padecimiento_actual);
  mapped.interrogatorio = asTexto(raw.interrogatorio) || base.interrogatorio;
  mapped.exploracion_fisica = asTexto(raw.objetivo) || asTexto(raw.exploracion_fisica) || base.exploracion_fisica;
  mapped.plan = asTexto(raw.plan);
  mapped.subjetivo = asTexto(raw.subjetivo) || mapped.padecimiento_actual;
  mapped.objetivo = asTexto(raw.objetivo);
  mapped.analisis = asTexto(raw.analisis);
  mapped.diagnostico = asTexto(raw.analisis) || asTexto(raw.diagnostico);
  mapped.diagnostico_cie10 = asTexto(raw.diagnostico_cie10);
  mapped.pronostico = asTexto(raw.pronostico);
  mapped.medicamentos = asTexto(raw.medicamentos) || base.medicamentos;
  mapped.estudios = asTexto(raw.estudios) || mapped.solicitudes_estudio.join('; ') || base.estudios;
  if (Array.isArray((incoming as NotaClinica).tratamiento)) {
    mapped.tratamiento = (incoming as NotaClinica).tratamiento;
  }
  if (!mapped.signos_vitales) mapped.signos_vitales = vacioSignosVitales();
  if (!Array.isArray(mapped.solicitudes_estudio)) mapped.solicitudes_estudio = [];
  if (!mapped.diagnostico_cie10) mapped.diagnostico_cie10 = '';

  return asegurarNotaStrings(mapped);
}
