import type { DictamenNom004, NotaClinica, PacienteExpediente } from '../types';

const NORMA = 'NOM-004-SSA3-2012';
const VACIO = /^(?:\s*|\[NO MENCIONADO\]|\[NOT DISCUSSED\]|n\/a|na|s\/?d|—)$/i;

function estaVacio(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value !== 'string') return true;
  return VACIO.test(value.trim());
}

export type IdentidadPacienteNom004 = Partial<
  Pick<PacienteExpediente, 'nombre_completo' | 'nombre' | 'apellido_paterno' | 'apellido_materno' | 'edad' | 'sexo' | 'domicilio' | 'ocupacion' | 'fecha_nacimiento'>
> & { nombre_paciente?: string };

function edadDesdeNacimiento(fecha?: string): string {
  const raw = (fecha ?? '').trim();
  if (!raw) return '';
  const d = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  let years = hoy.getUTCFullYear() - d.getUTCFullYear();
  const m = hoy.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < d.getUTCDate())) years -= 1;
  if (years < 0 || years > 130) return '';
  return `${years} años`;
}

function nombreDesdePaciente(paciente?: IdentidadPacienteNom004 | null, nombreConsulta?: string): string {
  const compuesto = [
    paciente?.nombre_completo,
    [paciente?.nombre, paciente?.apellido_paterno, paciente?.apellido_materno].filter(Boolean).join(' '),
    paciente?.nombre_paciente,
    nombreConsulta,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .find(Boolean);
  return compuesto ?? '';
}

/** Copia al SOAP la identificación ya capturada en el expediente (NOM-004 5.2.3 / 5.9). */
export function fusionarIdentidadPaciente(
  nota: NotaClinica,
  paciente?: IdentidadPacienteNom004 | null,
  nombreConsulta?: string,
): NotaClinica {
  const nombre = nombreDesdePaciente(paciente, nombreConsulta);
  return {
    ...nota,
    nombre_paciente: estaVacio(nota.nombre_paciente) ? nombre : nota.nombre_paciente,
    edad: estaVacio(nota.edad) ? ((paciente?.edad ?? '').trim() || edadDesdeNacimiento(paciente?.fecha_nacimiento)) : nota.edad,
    sexo: estaVacio(nota.sexo) ? (paciente?.sexo ?? '').trim() : nota.sexo,
    domicilio: estaVacio(nota.domicilio) ? (paciente?.domicilio ?? '').trim() : nota.domicilio,
    ocupacion: estaVacio(nota.ocupacion) ? (paciente?.ocupacion ?? '').trim() : nota.ocupacion,
  };
}

export function cedulaProfesionalValida(raw: unknown): boolean {
  const texto = String(raw ?? '').trim();
  if (!texto || VACIO.test(texto) || /^sin c[eé]dula$/i.test(texto)) return false;
  const compacto = texto.replace(/[\s.\-_/]/g, '');
  if (compacto.length < 2 || compacto.length > 32) return false;
  return /^[A-Za-zÁÉÍÓÚÜáéíóúüÑñ0-9]+$/.test(compacto);
}

function planMencionaMedicamento(texto: string): boolean {
  return /\b(?:mg|mcg|ml|ui|tablet|c[aá]psul|ampolle|jarabe|indic[oa]|prescrib|tomar|aplicar|administr)\b/i.test(texto);
}

function planTieneDosis(texto: string): boolean {
  return /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui|unidades?|tablet(?:as?)?|c[aá]psul(?:as?)?)\b/i.test(texto);
}

function planTieneVia(texto: string): boolean {
  return /\b(?:v[ií]a\s+)?(?:oral|vo|ev|i\.?v\.?|i\.?m\.?|s\.?c\.?|subcut[aá]nea|intravenosa|intramuscular|t[oó]pica|sublingual|inhalad|rectal|oft[aá]lmica|nasal)\b/i.test(texto);
}

function planTienePeriodicidad(texto: string): boolean {
  return /\b(?:cada\s+\d+|c\/\s*\d+|c\/24|c\/12|c\/8|c\/6|al d[ií]a|diario|diaria|bid|tid|qid|una vez al d[ií]a|dos veces|tres veces|por la noche|matutino|vespertino|hrs?|horas)\b/i.test(texto);
}

/** Recalcula el dictamen NOM-004 a partir de la nota y del expediente del paciente. */
export function validarNotaNom004(
  nota: NotaClinica,
  paciente?: IdentidadPacienteNom004 | null,
  nombreConsulta?: string,
): DictamenNom004 {
  const efectiva = fusionarIdentidadPaciente(nota, paciente, nombreConsulta);
  const faltantes: DictamenNom004['faltantes'] = [];
  const push = (campo: string, mensaje: string, numeral: string) => {
    faltantes.push({ campo, mensaje, numeral });
  };

  if (estaVacio(efectiva.nombre_paciente)) push('nombre_paciente', 'Falta el nombre completo del paciente', '5.2.3 / 5.9');
  if (estaVacio(efectiva.edad)) push('edad', 'Falta la edad del paciente', '5.2.3 / 5.9');
  if (estaVacio(efectiva.sexo)) push('sexo', 'Falta el sexo del paciente', '5.2.3 / 5.9');
  if (estaVacio(efectiva.domicilio)) push('domicilio', 'Falta el domicilio del paciente', '5.2.3');
  if (estaVacio(efectiva.fecha)) push('fecha', 'Falta la fecha de elaboración de la nota', '5.10');
  if (estaVacio(efectiva.hora)) push('hora', 'Falta la hora de elaboración de la nota', '5.10');
  if (estaVacio(efectiva.motivo_consulta)) push('motivo_consulta', 'Falta el motivo de consulta', '6.1.1 / 7.1.3');
  if (estaVacio(efectiva.exploracion_fisica) && estaVacio(efectiva.objetivo)) {
    push('exploracion_fisica', 'Falta la exploración física', '6.1.2 / 6.2.2');
  }
  if (estaVacio(efectiva.diagnostico) && estaVacio(efectiva.diagnostico_presuntivo) && estaVacio(efectiva.analisis)) {
    push('diagnostico', 'Falta el diagnóstico o problema clínico', '6.1.4 / 6.2.4');
  }
  if (estaVacio(efectiva.pronostico)) push('pronostico', 'Falta el pronóstico', '6.1.5 / 6.2.5');
  if (estaVacio(efectiva.medico_nombre)) push('medico_nombre', 'Falta el nombre completo del médico tratante', '5.10 / Apéndice D3.11');
  if (estaVacio(efectiva.medico_cedula) || !cedulaProfesionalValida(efectiva.medico_cedula)) {
    push(
      'medico_cedula',
      estaVacio(efectiva.medico_cedula)
        ? 'Falta la cédula profesional'
        : 'La cédula profesional no es válida. Use dígitos, letras o una abreviatura local (p. ej. MD).',
      'Apéndice D2.11 / D3.11',
    );
  }
  if (estaVacio(efectiva.sello_responsable) || !/Responsable:/i.test(efectiva.sello_responsable) || !/Cédula:/i.test(efectiva.sello_responsable)) {
    push('sello_responsable', 'Falta el sello de identificación legal del médico responsable (nombre, cédula y especialidad)', '5.10 / Apéndice D3.11');
  }

  const tratamiento = efectiva.tratamiento ?? [];
  if (tratamiento.length > 0) {
    tratamiento.forEach((item, index) => {
      const n = index + 1;
      if (estaVacio(item.medicamento)) push(`tratamiento.${index}.medicamento`, `Falta el nombre del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.dosis)) push(`tratamiento.${index}.dosis`, `Falta la dosis del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.via)) push(`tratamiento.${index}.via`, `Falta la vía de administración del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.periodicidad)) push(`tratamiento.${index}.periodicidad`, `Falta la periodicidad del medicamento #${n}`, '6.2.6');
    });
  } else {
    const plan = `${efectiva.plan ?? ''} ${efectiva.medicamentos ?? ''}`;
    if (estaVacio(efectiva.plan)) {
      push('plan', 'Falta el plan terapéutico', '6.1.6 / 6.2.6');
    } else if (planMencionaMedicamento(plan)) {
      if (!planTieneDosis(plan)) push('plan.dosis', 'Falta la dosis del medicamento', '6.2.6');
      if (!planTieneVia(plan)) push('plan.via', 'Falta la vía de administración del medicamento', '6.2.6');
      if (!planTienePeriodicidad(plan)) push('plan.periodicidad', 'Falta la periodicidad del medicamento', '6.2.6');
    }
  }

  return { cumple: faltantes.length === 0, norma: NORMA, faltantes, guia: faltantes.map((item) => item.mensaje) };
}
