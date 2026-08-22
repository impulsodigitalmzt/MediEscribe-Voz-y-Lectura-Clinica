import type { RecetaPaciente } from '../types';

const NOMBRE_DESCARTABLE =
  /^(fiebre|temp(?:eratura)?|saturaci[oó]n|presi[oó]n|tensi[oó]n|frecuencia|peso|talla|dolor|tos|d[ií]as|horas|evoluci[oó]n|paciente|reposo|casa|agua|aire)$/i;

export function normalizarTextoTratamiento(texto: string): string {
  return (texto ?? '')
    .replace(/\bmiligramos?\b/gi, 'mg')
    .replace(/\bmicrogramos?\b/gi, 'mcg')
    .replace(/\bgramos\b/gi, 'g')
    .replace(/\bcada\s+doce\b/gi, 'cada 12')
    .replace(/\bcada\s+ocho\b/gi, 'cada 8')
    .replace(/\bcada\s+seis\b/gi, 'cada 6')
    .replace(/\bcada\s+veinticuatro\b/gi, 'cada 24')
    .replace(/\bpor\s+siete\s+d[ií]as\b/gi, 'por 7 días')
    .replace(/\s+/g, ' ')
    .trim();
}

function capitalizarNombre(nombre: string): string {
  return nombre
    .replace(/\s+/g, ' ')
    .replace(/\s+de$/i, '')
    .trim()
    .split(' ')
    .map((palabra, index) => {
      const lower = palabra.toLowerCase();
      if (index > 0 && /^(de|con|y|el|la|los|las)$/i.test(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function extraerMedicamentosDeTexto(texto: string): RecetaPaciente['medicamentos'] {
  const fuente = normalizarTextoTratamiento(texto);
  const filas: RecetaPaciente['medicamentos'] = [];
  const vistos = new Set<string>();
  const patron =
    /(?:(?:le\s+)?(?:vamos\s+a\s+)?(?:dar|darle|indicar|indicarle|recetar|tomar|administrar)\s+)?([a-záéíóúñü][a-záéíóúñü0-9/.-]*(?:\s+(?:con|y|ácido|acido|clavulánico|clavulanico)[a-záéíóúñü\s/.-]{0,40})?)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|g|ml|ui)\b(?:[^.\n]{0,80}?\b(?:v[ií]a\s+)?(oral|vo|ev|i\.?v\.?|i\.?m\.?|s\.?c\.?|t[oó]pica|sublingual))?(?:[^.\n]{0,60}?\b(cada\s+\d+\s*(?:horas?|hrs?|h)|c\/\s*\d+))?(?:[^.\n]{0,40}?\b(por\s+\d+\s*d[ií]as?))?/gi;

  let match = patron.exec(fuente);
  while (match) {
    let nombre = (match[1] ?? '')
      .replace(/^(?:el|la|los|las|un|una|de)\s+/i, '')
      .replace(/^(?:dar|darle|indicar|indicarle|tomar|recetar|vamos a)\s+/i, '')
      .trim();
    if (nombre.length < 3 || NOMBRE_DESCARTABLE.test(nombre)) {
      match = patron.exec(fuente);
      continue;
    }
    const dosis = `${match[2]} ${match[3]}`.replace(/\s+/g, ' ');
    const clave = `${nombre.toLowerCase()}|${dosis}`;
    if (!vistos.has(clave)) {
      vistos.add(clave);
      const periodicidad = (match[5] ?? '').trim();
      const via = (match[4] ?? '').trim() || (/oral|tomar/i.test(match[0]) || periodicidad ? 'oral' : '');
      filas.push({
        medicamento: capitalizarNombre(nombre),
        dosis,
        via,
        periodicidad,
        instruccion: (match[6] ?? '').trim(),
      });
    }
    match = patron.exec(fuente);
  }
  return filas;
}

function frasesPorPatron(raw: string, patron: RegExp): string {
  const matches = raw.match(patron);
  if (!matches?.length) return '';
  return matches.map((item) => item.trim()).filter(Boolean).join('. ').replace(/\s+/g, ' ').trim();
}

export function planDesdeBorrador(texto: string): string {
  const fuente = normalizarTextoTratamiento(texto);
  const lineas: string[] = [];
  for (const med of extraerMedicamentosDeTexto(fuente)) {
    lineas.push(
      [med.medicamento, med.dosis, med.via ? `vía ${med.via}` : '', med.periodicidad, med.instruccion]
        .filter(Boolean)
        .join(' '),
    );
  }
  const estudios = frasesPorPatron(
    fuente,
    /[^.?!]*(?:radiograf|tomograf|laboratorio|estudio de|placa de)[^.?!]*[.?!]?/gi,
  );
  if (estudios) lineas.push(estudios.replace(/[.?!]+$/, ''));
  const medidas = frasesPorPatron(
    fuente,
    /[^.?!]*(?:reposo|hidrataci[oó]n|abundante l[ií]quido)[^.?!]*[.?!]?/gi,
  );
  if (medidas) lineas.push(medidas.replace(/[.?!]+$/, ''));
  return lineas.join('. ').replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
}

export function asegurarPlanYMedicamentos(input: {
  plan?: string;
  medicamentos?: RecetaPaciente['medicamentos'];
  borrador?: string;
}): { plan: string; medicamentos: RecetaPaciente['medicamentos'] } {
  const borrador = input.borrador ?? '';
  let plan = (input.plan ?? '').trim();
  if (!plan) plan = planDesdeBorrador(borrador);
  let medicamentos = Array.isArray(input.medicamentos)
    ? input.medicamentos.filter((row) => row.medicamento?.trim())
    : [];
  if (!medicamentos.length) {
    medicamentos = extraerMedicamentosDeTexto(`${plan}\n${borrador}`);
  }
  return { plan, medicamentos };
}
