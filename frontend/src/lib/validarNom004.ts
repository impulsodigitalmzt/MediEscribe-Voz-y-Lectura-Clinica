import type { DictamenNom004, NotaClinica } from '../types';

const NORMA = 'NOM-004-SSA3-2012';
const VACIO = /^(?:\s*|\[NO MENCIONADO\]|\[NOT DISCUSSED\]|n\/a|na|s\/?d|—)$/i;

function estaVacio(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (typeof value !== 'string') return true;
  return VACIO.test(value.trim());
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

/** Recalcula el dictamen NOM-004 a partir del estado actual de la nota. */
export function validarNotaNom004(nota: NotaClinica): DictamenNom004 {
  const faltantes: DictamenNom004['faltantes'] = [];
  const push = (campo: string, mensaje: string, numeral: string) => {
    faltantes.push({ campo, mensaje, numeral });
  };

  if (estaVacio(nota.nombre_paciente)) push('nombre_paciente', 'Falta el nombre completo del paciente', '5.2.3 / 5.9');
  if (estaVacio(nota.edad)) push('edad', 'Falta la edad del paciente', '5.2.3 / 5.9');
  if (estaVacio(nota.sexo)) push('sexo', 'Falta el sexo del paciente', '5.2.3 / 5.9');
  if (estaVacio(nota.domicilio)) push('domicilio', 'Falta el domicilio del paciente', '5.2.3');
  if (estaVacio(nota.fecha)) push('fecha', 'Falta la fecha de elaboración de la nota', '5.10');
  if (estaVacio(nota.hora)) push('hora', 'Falta la hora de elaboración de la nota', '5.10');
  if (estaVacio(nota.motivo_consulta)) push('motivo_consulta', 'Falta el motivo de consulta', '6.1.1 / 7.1.3');
  if (estaVacio(nota.exploracion_fisica) && estaVacio(nota.objetivo)) {
    push('exploracion_fisica', 'Falta la exploración física', '6.1.2 / 6.2.2');
  }
  if (estaVacio(nota.diagnostico) && estaVacio(nota.diagnostico_presuntivo) && estaVacio(nota.analisis)) {
    push('diagnostico', 'Falta el diagnóstico o problema clínico', '6.1.4 / 6.2.4');
  }
  if (estaVacio(nota.pronostico)) push('pronostico', 'Falta el pronóstico', '6.1.5 / 6.2.5');
  if (estaVacio(nota.medico_nombre)) push('medico_nombre', 'Falta el nombre completo del médico tratante', '5.10 / Apéndice D3.11');
  if (estaVacio(nota.medico_cedula) || !cedulaProfesionalValida(nota.medico_cedula)) {
    push(
      'medico_cedula',
      estaVacio(nota.medico_cedula)
        ? 'Falta la cédula profesional'
        : 'La cédula profesional no es válida. Use dígitos, letras o una abreviatura local (p. ej. MD).',
      'Apéndice D2.11 / D3.11',
    );
  }
  if (estaVacio(nota.sello_responsable) || !/Responsable:/i.test(nota.sello_responsable) || !/Cédula:/i.test(nota.sello_responsable)) {
    push('sello_responsable', 'Falta el sello de identificación legal del médico responsable (nombre, cédula y especialidad)', '5.10 / Apéndice D3.11');
  }

  const tratamiento = nota.tratamiento ?? [];
  if (tratamiento.length > 0) {
    tratamiento.forEach((item, index) => {
      const n = index + 1;
      if (estaVacio(item.medicamento)) push(`tratamiento.${index}.medicamento`, `Falta el nombre del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.dosis)) push(`tratamiento.${index}.dosis`, `Falta la dosis del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.via)) push(`tratamiento.${index}.via`, `Falta la vía de administración del medicamento #${n}`, '6.2.6');
      if (estaVacio(item.periodicidad)) push(`tratamiento.${index}.periodicidad`, `Falta la periodicidad del medicamento #${n}`, '6.2.6');
    });
  } else {
    const plan = `${nota.plan ?? ''} ${nota.medicamentos ?? ''}`;
    if (estaVacio(nota.plan)) {
      push('plan', 'Falta el plan terapéutico', '6.1.6 / 6.2.6');
    } else if (planMencionaMedicamento(plan)) {
      if (!planTieneDosis(plan)) push('plan.dosis', 'Falta la dosis del medicamento', '6.2.6');
      if (!planTieneVia(plan)) push('plan.via', 'Falta la vía de administración del medicamento', '6.2.6');
      if (!planTienePeriodicidad(plan)) push('plan.periodicidad', 'Falta la periodicidad del medicamento', '6.2.6');
    }
  }

  return { cumple: faltantes.length === 0, norma: NORMA, faltantes, guia: faltantes.map((item) => item.mensaje) };
}
