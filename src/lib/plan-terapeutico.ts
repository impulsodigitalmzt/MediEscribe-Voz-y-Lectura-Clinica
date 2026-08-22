export type MedicamentoAislado = {
  medicamento: string;
  dosis: string;
  via: string;
  periodicidad: string;
  instruccion: string;
};

const NOMBRE_DESCARTABLE =
  /^(fiebre|temp(?:eratura)?|saturaci[oó]n|presi[oó]n|tensi[oó]n|frecuencia|peso|talla|dolor|tos|d[ií]as|horas|evoluci[oó]n|paciente|reposo|casa|agua|aire)$/i;

export function normalizarTextoTratamiento(texto: string): string {
  return (texto ?? "")
    .replace(/\bmiligramos?\b/gi, "mg")
    .replace(/\bmicrogramos?\b/gi, "mcg")
    .replace(/\bgramos\b/gi, "g")
    .replace(/\bcada\s+doce\b/gi, "cada 12")
    .replace(/\bcada\s+ocho\b/gi, "cada 8")
    .replace(/\bcada\s+seis\b/gi, "cada 6")
    .replace(/\bcada\s+veinticuatro\b/gi, "cada 24")
    .replace(/\bpor\s+siete\s+d[ií]as\b/gi, "por 7 días")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizarNombre(nombre: string): string {
  return nombre
    .replace(/\s+/g, " ")
    .replace(/\s+de$/i, "")
    .trim()
    .split(" ")
    .map((palabra, index) => {
      const lower = palabra.toLowerCase();
      if (index > 0 && /^(de|con|y|el|la|los|las)$/i.test(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

const VIA_ORAL =
  /\b(?:tomar|t[oó]mese|t[oó]mela|se va a tomar|va a tomar|v[ií]a\s+oral|\bvo\b|tabletas?|c[aá]psulas?|comprimidos?|jarabe)\b/i;
const VIA_IV = /\b(?:intravenos|endovenos|\bi\.?v\.?\b|\bev\b)\b/i;
const VIA_IM = /\b(?:intramuscular|\bi\.?m\.?\b)\b/i;

export function inferirViaAdministracion(viaActual: string, contexto: string): string {
  const actual = (viaActual ?? "").trim();
  if (actual) {
    if (/^(vo|v[ií]a\s+oral)$/i.test(actual)) return "oral";
    return actual;
  }
  const c = contexto ?? "";
  if (VIA_IV.test(c)) return "IV";
  if (VIA_IM.test(c)) return "IM";
  if (/\b(?:subcut[aá]nea|\bs\.?c\.?\b)/i.test(c)) return "subcutánea";
  if (/\binhal/i.test(c)) return "inhalada";
  if (/\bsublingual/i.test(c)) return "sublingual";
  if (/\bt[oó]pic/i.test(c)) return "tópica";
  if (VIA_ORAL.test(c)) return "oral";
  return "";
}

function ventanaMedicamento(nombre: string, texto: string): string {
  const fuente = (texto ?? "").replace(/\s+/g, " ");
  const clave = nombre.split(/[/,]/)[0].trim().slice(0, 10).toLowerCase();
  if (!clave) return fuente;
  const idx = fuente.toLowerCase().indexOf(clave);
  if (idx < 0) return fuente;
  return fuente.slice(Math.max(0, idx - 40), Math.min(fuente.length, idx + 220));
}

export function completarViasMedicamentos<
  T extends { medicamento: string; via: string; dosis?: string; periodicidad?: string },
>(meds: T[], texto: string): T[] {
  const hayTomarGlobal = VIA_ORAL.test(texto);
  return meds.map((row) => {
    const ventana = ventanaMedicamento(row.medicamento, texto);
    let via = inferirViaAdministracion(row.via, `${ventana} ${row.via}`);
    if (!via && hayTomarGlobal && !VIA_IV.test(ventana) && !VIA_IM.test(ventana)) {
      via = "oral";
    }
    if (!via && /\bmg\b/i.test(row.dosis ?? "") && (row.periodicidad ?? "").trim() && !VIA_IV.test(ventana) && !VIA_IM.test(ventana)) {
      via = "oral";
    }
    return { ...row, via };
  });
}

export function extraerMedicamentosDeTexto(texto: string): MedicamentoAislado[] {
  const fuente = normalizarTextoTratamiento(texto);
  const filas: MedicamentoAislado[] = [];
  const vistos = new Set<string>();
  const patron =
    /(?:(?:le\s+)?(?:vamos\s+a\s+)?(?:dar|darle|indicar|indicarle|recetar|tomar|administrar)\s+)?([a-záéíóúñü][a-záéíóúñü0-9/.-]*(?:\s+(?:con|y|ácido|acido|clavulánico|clavulanico)[a-záéíóúñü\s/.-]{0,40})?)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|g|ml|ui)\b(?:[^.\n]{0,80}?\b(?:v[ií]a\s+)?(oral|vo|ev|i\.?v\.?|i\.?m\.?|s\.?c\.?|t[oó]pica|sublingual))?(?:[^.\n]{0,60}?\b(cada\s+\d+\s*(?:horas?|hrs?|h)|c\/\s*\d+))?(?:[^.\n]{0,40}?\b(por\s+\d+\s*d[ií]as?))?/gi;

  let match = patron.exec(fuente);
  while (match) {
    let nombre = (match[1] ?? "")
      .replace(/^(?:el|la|los|las|un|una|de)\s+/i, "")
      .replace(/^(?:dar|darle|indicar|indicarle|tomar|recetar|vamos a)\s+/i, "")
      .trim();
    if (nombre.length < 3 || NOMBRE_DESCARTABLE.test(nombre)) {
      match = patron.exec(fuente);
      continue;
    }
    const dosis = `${match[2]} ${match[3]}`.replace(/\s+/g, " ");
    const clave = `${nombre.toLowerCase()}|${dosis}`;
    if (!vistos.has(clave)) {
      vistos.add(clave);
      const periodicidad = (match[5] ?? "").trim();
      const via = inferirViaAdministracion(match[4] ?? "", `${match[0]} ${fuente}`);
      filas.push({
        medicamento: capitalizarNombre(nombre),
        dosis,
        via,
        periodicidad,
        instruccion: (match[6] ?? "").trim(),
      });
    }
    match = patron.exec(fuente);
  }
  return completarViasMedicamentos(filas, fuente);
}

function frasesPorPatron(texto: string, patron: RegExp): string {
  const matches = texto.match(patron);
  if (!matches?.length) return "";
  return matches.map((item) => item.trim()).filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
}

export function planDesdeBorrador(texto: string): string {
  const fuente = normalizarTextoTratamiento(texto);
  const lineas: string[] = [];
  for (const med of extraerMedicamentosDeTexto(fuente)) {
    lineas.push(
      [med.medicamento, med.dosis, med.via ? `vía ${med.via}` : "", med.periodicidad, med.instruccion]
        .filter(Boolean)
        .join(" ")
    );
  }
  const estudios = frasesPorPatron(
    fuente,
    /[^.?!]*(?:radiograf|tomograf|laboratorio|estudio de|placa de)[^.?!]*[.?!]?/gi
  );
  if (estudios) lineas.push(estudios.replace(/[.?!]+$/, ""));
  const medidas = frasesPorPatron(
    fuente,
    /[^.?!]*(?:reposo|hidrataci[oó]n|abundante l[ií]quido)[^.?!]*[.?!]?/gi
  );
  if (medidas) lineas.push(medidas.replace(/[.?!]+$/, ""));
  return lineas.join(". ").replace(/\s+/g, " ").replace(/\.\s*\./g, ".").trim();
}
