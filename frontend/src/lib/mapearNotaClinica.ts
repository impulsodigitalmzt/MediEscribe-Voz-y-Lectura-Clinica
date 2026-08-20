import type { NotaClinica, SignosVitales } from '../types';
import { vacioSignosVitales } from '../types';

function asTexto(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const row = item as Record<string, unknown>;
          return [row.medicamento ?? row.nombre, row.dosis, row.via ?? row['vía'], row.periodicidad ?? row.frecuencia]
            .filter((part) => typeof part === 'string' && part.trim())
            .join(' ');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
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
    campos_inciertos: [], secciones_faltantes: [], sello_responsable: '',
  };
}

/**
 * Asigna el JSON clínico (SOAP / NOM-004) a los campos del editor.
 * Nunca usa la transcripción cruda como valor de un textarea.
 */
export function mapearNotaDesdeIA(
  incoming: Partial<NotaClinica> | Record<string, unknown> | null | undefined,
  base: NotaClinica,
): NotaClinica {
  if (!incoming || typeof incoming !== 'object') return base;
  const raw = aplanarSoap(incoming as Record<string, unknown>);
  const mapped: NotaClinica = {
    ...base,
    ...(incoming as Partial<NotaClinica>),
    signos_vitales: parseSignos(raw, base.signos_vitales ?? vacioSignosVitales()),
    solicitudes_estudio: parseSolicitudes(raw, base.solicitudes_estudio ?? []),
  };

  mapped.motivo_consulta = asTexto(raw.motivo_consulta) || mapped.motivo_consulta;
  mapped.padecimiento_actual = asTexto(raw.padecimiento_actual) || mapped.padecimiento_actual;
  mapped.interrogatorio = asTexto(raw.interrogatorio) || mapped.interrogatorio;
  mapped.exploracion_fisica = asTexto(raw.exploracion_fisica) || mapped.exploracion_fisica;
  const dx = diagnosticoConCie10(raw);
  mapped.diagnostico = dx.diagnostico || mapped.diagnostico;
  mapped.diagnostico_cie10 = dx.cie10 || mapped.diagnostico_cie10;
  mapped.plan = asTexto(raw.plan_tratamiento) || asTexto(raw.plan) || mapped.plan;
  mapped.medicamentos = asTexto(raw.medicamentos) || mapped.medicamentos;
  mapped.pronostico = asTexto(raw.pronostico) || asTexto(raw.pronóstico) || mapped.pronostico;
  mapped.estudios = asTexto(raw.estudios) || mapped.solicitudes_estudio.join('; ') || mapped.estudios;
  if (!mapped.signos_vitales) mapped.signos_vitales = vacioSignosVitales();
  if (!Array.isArray(mapped.solicitudes_estudio)) mapped.solicitudes_estudio = [];
  if (!mapped.diagnostico_cie10) mapped.diagnostico_cie10 = '';

  return mapped;
}
