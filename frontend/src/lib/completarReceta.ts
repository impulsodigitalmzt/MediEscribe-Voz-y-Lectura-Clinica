import type { RecetaPaciente } from '../types';
import { extraerMedicamentosDeTexto } from './completarPlan';

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
  if (!receta.medicamentos.length) {
    receta.medicamentos = extraerMedicamentosDeTexto(`${plan}\n${fuente}`);
  }
  return receta;
}
