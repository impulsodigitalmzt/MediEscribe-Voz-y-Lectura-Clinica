import type { RecetaPaciente } from '../types';

function texto(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function primeraFrase(raw: string): string {
  return raw.split(/[.\n]/).map((parte) => parte.trim()).find(Boolean) ?? '';
}

function frasesPorPatron(raw: string, patron: RegExp): string {
  const matches = raw.match(patron);
  if (!matches?.length) return '';
  return matches.map((item) => item.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function medicamentosDesdePlan(plan: string): RecetaPaciente['medicamentos'] {
  const filas: RecetaPaciente['medicamentos'] = [];
  const patron =
    /([A-ZÁÉÍÓÚÑÜa-záéíóúñü][\wÁÉÍÓÚÑÜáéíóúñü/.-]*(?:\s+[A-ZÁÉÍÓÚÑÜa-záéíóúñü][\wÁÉÍÓÚÑÜáéíóúñü/.-]*){0,5})\s+(\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui))\b(?:[^.\n]*?\b(v[ií]a\s+)?(oral|vo|ev|i\.?v\.?|i\.?m\.?|s\.?c\.?|t[oó]pica|sublingual))?(?:[^.\n]*?\b(cada\s+\d+\s*(?:horas?|hrs?|h)|c\/\s*\d+))?(?:[^.\n]*?\b(por\s+\d+\s*d[ií]as?))?/gi;
  let match = patron.exec(plan);
  while (match) {
    const medicamento = (match[1] ?? '').replace(/^(?:indicar|indicarle|dar|darle|tomar|recetar)\s+/i, '').trim();
    if (medicamento) {
      filas.push({
        medicamento,
        dosis: (match[2] ?? '').trim(),
        via: (match[4] ?? '').trim(),
        periodicidad: (match[5] ?? '').trim(),
        instruccion: (match[6] ?? '').trim(),
      });
    }
    match = patron.exec(plan);
  }
  return filas;
}

/** Completa la receta inferior si Groq dejó un campo vacío pero el SOAP/borrador ya lo dicen. */
export function completarRecetaDesdeSoap(input: {
  receta?: Partial<RecetaPaciente> | null;
  analisis?: string;
  plan?: string;
  borrador?: string;
}): RecetaPaciente {
  const receta: RecetaPaciente = {
    idioma: texto(input.receta?.idioma),
    idioma_nombre: texto(input.receta?.idioma_nombre),
    titulo: texto(input.receta?.titulo),
    resumen: texto(input.receta?.resumen),
    indicaciones: texto(input.receta?.indicaciones),
    medicamentos: Array.isArray(input.receta?.medicamentos)
      ? input.receta!.medicamentos!.filter((row) => row.medicamento?.trim())
      : [],
    alarmas: texto(input.receta?.alarmas),
    seguimiento: texto(input.receta?.seguimiento),
  };
  const analisis = texto(input.analisis);
  const plan = texto(input.plan);
  const fuente = `${texto(input.borrador)}\n${plan}`;

  if (!receta.titulo) {
    const dx = primeraFrase(analisis).replace(/\s*\(.*$/, '').slice(0, 80);
    receta.titulo = dx ? `Tratamiento para ${dx}` : plan ? 'Tratamiento indicado' : '';
  }
  if (!receta.indicaciones) {
    receta.indicaciones = plan || frasesPorPatron(
      fuente,
      /[^.?!]*(?:reposo|hidrataci[oó]n|radiograf[ií]a|tomar|v[ií]a oral|cada\s+\d+)[^.?!]*[.?!]?/gi,
    );
  }
  if (!receta.alarmas) {
    receta.alarmas = frasesPorPatron(
      fuente,
      /[^.?!]*(?:urgenc|empeor|falta(?:r)?(?:le)?(?:\s+m[aá]s)?\s+el aire|disnea|si (?:aumenta|empeora|se pone peor)|alarma)[^.?!]*[.?!]?/gi,
    );
  }
  if (!receta.seguimiento) {
    receta.seguimiento = frasesPorPatron(
      fuente,
      /[^.?!]*(?:en\s+\d+\s*d[ií]as|control(?:\s+ambulatorio)?|cita de revisi[oó]n|seguimiento|revisi[oó]n m[eé]dica)[^.?!]*[.?!]?/gi,
    );
  }
  if (!receta.resumen) {
    const dx = primeraFrase(analisis);
    receta.resumen = [dx ? `Le diagnosticaron ${dx}.` : '', receta.indicaciones || plan].filter(Boolean).join(' ').slice(0, 800);
  }
  if (!receta.medicamentos.length && plan) {
    receta.medicamentos = medicamentosDesdePlan(plan);
  }
  return receta;
}
