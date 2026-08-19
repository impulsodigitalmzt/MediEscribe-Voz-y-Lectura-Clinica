import { clipTranscript } from "./audio";
import { groqChatJson, normalizeLanguageCode } from "./groq";
import { extractClinicalEntities } from "./nlp";
import { validarNotaNom004 } from "./guardia-legal";
import type {
  DatosMedico,
  DocumentacionConsulta,
  IndicacionTerapeutica,
  NotaClinica,
  RecetaPaciente,
} from "./nota-types";

export type {
  DatosMedico,
  DocumentacionConsulta,
  IndicacionTerapeutica,
  NotaClinica,
  RecetaPaciente,
} from "./nota-types";

const NO_MENCIONADO = "[NO MENCIONADO]";

const IDIOMA_NOMBRE: Record<string, string> = {
  es: "español",
  en: "English",
  fr: "français",
  pt: "português",
  de: "Deutsch",
  it: "italiano",
  ar: "العربية",
  zh: "中文",
  hi: "हिन्दी",
  ja: "日本語",
  ko: "한국어",
  ru: "русский",
  nl: "Nederlands",
  pl: "polski",
  tr: "Türkçe",
  vi: "Tiếng Việt",
  th: "ไทย",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
  sw: "Kiswahili",
};

const SYSTEM_PROMPT = `Eres el motor de documentación clínica de MediEscribe.
A partir de la transcripción de una consulta (en cualquier idioma), extrae únicamente lo dicho y genera SIEMPRE dos bloques JSON separados.

BLOQUE 1 — nota_medica_espanol (OBLIGATORIO, SOLO ESPAÑOL):
Nota de evolución / consulta para el expediente clínico, redactada estrictamente en español clínico profesional, conforme a NOM-004-SSA3-2012.
Debe incluir identificación del paciente, fecha, hora, motivo, exploración física, diagnóstico, pronóstico y tratamiento estructurado (dosis, vía, periodicidad).
Si un dato no se mencionó, usa exactamente "${NO_MENCIONADO}". NUNCA inventes.

BLOQUE 2 — receta_paciente_nativo (OBLIGATORIO, IDIOMA NATIVO DETECTADO):
Indicaciones, receta y resumen PARA EL PACIENTE, en el idioma nativo de la consulta (el que habló el paciente / el detectado por Whisper).
Lenguaje claro, sin jerga innecesaria, listo para imprimir o enviar. No copies la nota clínica; traduce y simplifica las indicaciones terapéuticas.

IDENTIFICACIÓN (en nota_medica_espanol):
nombre_paciente, edad, ocupacion. Si no se mencionaron, "${NO_MENCIONADO}".

REGLAS:
1. NUNCA inventes datos clínicos.
2. Conserva la incertidumbre. Marca dudas en campos_inciertos.
3. Elimina saludos, charla social y muletillas.
4. motivo_consulta y padecimiento_actual son secciones distintas.
5. resumen (en español) = 2-4 oraciones con identificación, motivo, diagnóstico y plan.
6. Si hay EXPEDIENTE MAESTRO, copia identificación desde ahí. El historial previo no es el cuadro de HOY.
7. idioma_detectado: código ISO 639-1 del idioma de la conversación (es, en, fr, pt, etc.).
8. Devuelve SOLO un objeto JSON con exactamente estas claves de primer nivel:
   idioma_detectado (string),
   nota_medica_espanol (objeto),
   receta_paciente_nativo (objeto).

nota_medica_espanol claves:
   nombre_paciente, edad, sexo, domicilio, ocupacion, fecha, hora,
   motivo_consulta, padecimiento_actual, interrogatorio, antecedentes_personales,
   antecedentes_quirurgicos, medicamentos, alergias, antecedentes_familiares,
   antecedentes_sociales, exploracion_fisica, estudios, diagnostico_presuntivo,
   diagnosticos_diferenciales, diagnostico, pronostico, plan, tratamiento (array de
   {medicamento, dosis, via, periodicidad}), seguimiento, notas_evolucion, resumen,
   medico_nombre, medico_cedula,
   campos_inciertos (array de strings), secciones_faltantes (array de strings).

receta_paciente_nativo claves:
   idioma, idioma_nombre, titulo, resumen, indicaciones,
   medicamentos (array de {medicamento, dosis, via, periodicidad, instruccion}),
   alarmas, seguimiento.`;

const TEXT_KEYS = [
  "nombre_paciente",
  "edad",
  "sexo",
  "domicilio",
  "ocupacion",
  "fecha",
  "hora",
  "medico_nombre",
  "medico_cedula",
  "motivo_consulta",
  "padecimiento_actual",
  "interrogatorio",
  "antecedentes_personales",
  "antecedentes_quirurgicos",
  "medicamentos",
  "alergias",
  "antecedentes_familiares",
  "antecedentes_sociales",
  "exploracion_fisica",
  "estudios",
  "diagnostico_presuntivo",
  "diagnosticos_diferenciales",
  "diagnostico",
  "pronostico",
  "plan",
  "seguimiento",
  "notas_evolucion",
  "resumen",
] as const;

export function nombreIdioma(code: string): string {
  return IDIOMA_NOMBRE[code] || code || "idioma detectado";
}

function ahoraMexico(): { fecha: string; hora: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mazatlan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { fecha: `${get("year")}-${get("month")}-${get("day")}`, hora: `${get("hour")}:${get("minute")}` };
}

function estaVacioLocal(value: string | undefined): boolean {
  return !value || /^(?:\s*|\[NO MENCIONADO\]|\[NOT DISCUSSED\]|n\/a|na|s\/?d)$/i.test(value);
}

export function aplicarIdentidadPaciente(
  nota: NotaClinica,
  paciente: {
    nombre_completo: string;
    edad: string;
    sexo: string;
    domicilio: string;
    ocupacion: string;
    antecedentes_importantes?: { alergias?: string; cronicos?: string };
  }
): NotaClinica {
  const next = { ...nota };
  next.nombre_paciente = paciente.nombre_completo || next.nombre_paciente;
  if (paciente.edad) next.edad = paciente.edad;
  if (paciente.sexo) next.sexo = paciente.sexo;
  if (paciente.domicilio) next.domicilio = paciente.domicilio;
  if (paciente.ocupacion && estaVacioLocal(next.ocupacion)) next.ocupacion = paciente.ocupacion;
  if (paciente.antecedentes_importantes?.alergias && estaVacioLocal(next.alergias)) {
    next.alergias = paciente.antecedentes_importantes.alergias;
  }
  if (paciente.antecedentes_importantes?.cronicos && estaVacioLocal(next.antecedentes_personales)) {
    next.antecedentes_personales = paciente.antecedentes_importantes.cronicos;
  }
  if (estaVacioLocal(next.notas_evolucion)) {
    next.notas_evolucion = next.padecimiento_actual;
  }
  return next;
}

export function selloResponsableLegal(nombre: string, cedula: string, especialidad = ""): string {
  const n = (nombre ?? "").trim() || "Médico no identificado";
  const c = (cedula ?? "").trim() || "sin cédula";
  const e = (especialidad ?? "").trim() || "sin especialidad";
  return `Responsable: ${n} | Cédula: ${c} | Especialidad: ${e}`;
}

export function aplicarSelloLegal(nota: NotaClinica, datos: DatosMedico = {}): NotaClinica {
  const nombre = (datos.medicoNombre ?? "").trim() || (nota.medico_nombre ?? "").trim();
  const cedula = (datos.medicoCedula ?? "").trim() || (nota.medico_cedula ?? "").trim();
  const especialidad =
    (datos.medicoEspecialidad ?? "").trim() || (nota.medico_especialidad ?? "").trim();
  return {
    ...nota,
    medico_nombre: nombre,
    medico_cedula: cedula,
    medico_especialidad: especialidad,
    sello_responsable: selloResponsableLegal(nombre, cedula, especialidad),
  };
}

export function notaDesdeExpediente(
  paciente: {
    nombre_completo: string;
    edad: string;
    sexo: string;
    domicilio: string;
    ocupacion: string;
    antecedentes_importantes?: {
      alergias?: string;
      cronicos?: string;
      heredo_familiares?: string;
      personales_patologicos?: string;
      personales_no_patologicos?: string;
    };
  },
  datos: DatosMedico = {}
): NotaClinica {
  const sello = ahoraMexico();
  const ant = paciente.antecedentes_importantes ?? {};
  const personales = [ant.cronicos, ant.personales_patologicos].filter(Boolean).join(". ");
  return {
    nombre_paciente: paciente.nombre_completo,
    edad: paciente.edad,
    sexo: paciente.sexo,
    domicilio: paciente.domicilio,
    ocupacion: paciente.ocupacion,
    fecha: sello.fecha,
    hora: sello.hora,
    medico_nombre: datos.medicoNombre ?? "",
    medico_cedula: datos.medicoCedula ?? "",
    medico_especialidad: datos.medicoEspecialidad ?? "",
    motivo_consulta: "",
    padecimiento_actual: "",
    interrogatorio: "",
    antecedentes_personales: personales,
    antecedentes_quirurgicos: "",
    medicamentos: "",
    alergias: ant.alergias ?? "",
    antecedentes_familiares: ant.heredo_familiares ?? "",
    antecedentes_sociales: ant.personales_no_patologicos ?? "",
    exploracion_fisica: "",
    estudios: "",
    diagnostico_presuntivo: "",
    diagnosticos_diferenciales: "",
    diagnostico: "",
    pronostico: "",
    plan: "",
    tratamiento: [],
    seguimiento: "",
    notas_evolucion: "",
    resumen: "",
    campos_inciertos: [],
    secciones_faltantes: [],
    sello_responsable: selloResponsableLegal(
      datos.medicoNombre ?? "",
      datos.medicoCedula ?? "",
      datos.medicoEspecialidad ?? ""
    ),
  };
}

export async function redactarNotaClinica(
  env: Env,
  transcripcion: string,
  especialidad = "medicina_general",
  pacienteConocido?: string,
  datos: DatosMedico = {},
  contextoExpediente = "",
  idiomaWhisper = ""
): Promise<DocumentacionConsulta> {
  const clipped = clipTranscript(transcripcion, 1200);
  const entities = extractClinicalEntities(clipped);
  const conocido =
    pacienteConocido && pacienteConocido !== "Paciente sin identificar" ? pacienteConocido : "";
  const idiomaHint = normalizeLanguageCode(idiomaWhisper) || detectarIdiomaTexto(clipped);
  const nombreNativo = nombreIdioma(idiomaHint || "es");

  try {
    const raw = await groqChatJson(env, [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Especialidad: ${especialidad}
Idioma detectado por Whisper (úsalo en receta_paciente_nativo e idioma_detectado): ${idiomaHint || "desconocido — detéctalo de la transcripción"} (${nombreNativo})
${conocido ? `Nombre conocido del expediente (úsalo en nombre_paciente): ${conocido}` : "No hay nombre previo; extrae identificación de la transcripción."}
${datos.sexo ? `Sexo conocido: ${datos.sexo}` : ""}
${datos.domicilio ? `Domicilio conocido: ${datos.domicilio}` : ""}
${datos.medicoNombre ? `Médico tratante: ${datos.medicoNombre}` : ""}
${datos.medicoCedula ? `Cédula profesional: ${datos.medicoCedula}` : ""}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

nota_medica_espanol: SIEMPRE en español (NOM-004).
receta_paciente_nativo: SIEMPRE en ${nombreNativo}.

TRANSCRIPCIÓN DE ESTA CONSULTA:
${clipped}

Devuelve SOLO el JSON con idioma_detectado, nota_medica_espanol y receta_paciente_nativo.`,
      },
    ]);
    const parsed = parseDocumentacionDual(raw, clipped, conocido, datos, idiomaHint);
    parsed.nota = await completarNotaNom004(env, parsed.nota, clipped, contextoExpediente);
    return parsed;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "nota_clinica_fallback",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    const nota = fallbackNota(clipped, entities, conocido, datos);
    return {
      nota,
      receta: recetaDesdeNota(nota, idiomaHint || "es"),
      idioma_detectado: idiomaHint || "es",
    };
  }
}

export function normalizeNota(
  raw: Record<string, unknown>,
  transcripcion: string,
  pacienteConocido = "",
  datos: DatosMedico = {}
): NotaClinica {
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return NO_MENCIONADO;
  };
  const list = (key: string) =>
    Array.isArray(raw[key]) ? raw[key].filter((item): item is string => typeof item === "string") : [];

  const extraida = extraerIdentificacion(transcripcion);
  let nombre = text("nombre_paciente", "nombre", "patient_name");
  if (nombre === NO_MENCIONADO) nombre = extraida.nombre || pacienteConocido || NO_MENCIONADO;
  const edad = text("edad", "age");
  const ocupacion = text("ocupacion", "ocupación", "occupation");
  const sello = ahoraMexico();
  const tratamiento = parseTratamiento(raw.tratamiento);

  const nota: NotaClinica = {
    nombre_paciente: nombre,
    edad: edad === NO_MENCIONADO ? extraida.edad || NO_MENCIONADO : edad,
    sexo: orKnown(text("sexo", "sex"), datos.sexo),
    domicilio: orKnown(text("domicilio", "direccion", "dirección"), datos.domicilio),
    ocupacion: ocupacion === NO_MENCIONADO ? extraida.ocupacion || NO_MENCIONADO : ocupacion,
    fecha: orKnown(text("fecha"), sello.fecha),
    hora: orKnown(text("hora"), sello.hora),
    medico_nombre: orKnown(text("medico_nombre", "medico", "physician_name"), datos.medicoNombre),
    medico_cedula: orKnown(text("medico_cedula", "cedula", "cédula"), datos.medicoCedula),
    medico_especialidad: orKnown(text("medico_especialidad", "especialidad", "specialty"), datos.medicoEspecialidad),
    motivo_consulta: text("motivo_consulta"),
    padecimiento_actual: text("padecimiento_actual"),
    interrogatorio: text("interrogatorio"),
    antecedentes_personales: text("antecedentes_personales"),
    antecedentes_quirurgicos: text("antecedentes_quirurgicos"),
    medicamentos: text("medicamentos"),
    alergias: text("alergias"),
    antecedentes_familiares: text("antecedentes_familiares"),
    antecedentes_sociales: text("antecedentes_sociales"),
    exploracion_fisica: text("exploracion_fisica"),
    estudios: text("estudios"),
    diagnostico_presuntivo: text("diagnostico_presuntivo"),
    diagnosticos_diferenciales: text("diagnosticos_diferenciales"),
    diagnostico: text("diagnostico"),
    pronostico: text("pronostico", "pronóstico"),
    plan: text("plan"),
    tratamiento,
    seguimiento: text("seguimiento"),
    notas_evolucion: text("notas_evolucion", "evolucion"),
    resumen: text("resumen"),
    campos_inciertos: list("campos_inciertos"),
    secciones_faltantes: list("secciones_faltantes"),
    sello_responsable: "",
  };

  if (nota.resumen === NO_MENCIONADO) {
    nota.resumen = buildResumen(nota);
  }
  if (nota.secciones_faltantes.length === 0) {
    nota.secciones_faltantes = TEXT_KEYS.filter((key) => nota[key] === NO_MENCIONADO);
  }
  if (transcripcion.trim().length < 40 && !nota.campos_inciertos.includes("transcripcion_corta")) {
    nota.campos_inciertos = [...nota.campos_inciertos, "transcripcion_corta"];
  }
  return aplicarSelloLegal(nota, datos);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseDocumentacionDual(
  raw: Record<string, unknown>,
  transcripcion: string,
  pacienteConocido: string,
  datos: DatosMedico,
  idiomaHint: string
): DocumentacionConsulta {
  const notaRaw = asObject(raw.nota_medica_espanol) ?? asObject(raw.nota) ?? raw;
  const recetaRaw = asObject(raw.receta_paciente_nativo) ?? asObject(raw.receta);
  const idioma =
    normalizeLanguageCode(String(raw.idioma_detectado ?? recetaRaw?.idioma ?? "")) || idiomaHint || "es";
  const nota = normalizeNota(notaRaw, transcripcion, pacienteConocido, datos);
  const receta = recetaRaw ? parseReceta(recetaRaw, idioma, nota) : recetaDesdeNota(nota, idioma);
  receta.idioma = receta.idioma || idioma;
  receta.idioma_nombre = receta.idioma_nombre || nombreIdioma(receta.idioma);
  return { nota, receta, idioma_detectado: idioma };
}

export function parseReceta(raw: Record<string, unknown>, idioma: string, nota?: NotaClinica): RecetaPaciente {
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const meds = Array.isArray(raw.medicamentos)
    ? raw.medicamentos.map((item) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const asText = (key: string) => (typeof row[key] === "string" ? row[key].trim() : "");
        return {
          medicamento: asText("medicamento") || asText("nombre"),
          dosis: asText("dosis"),
          via: asText("via") || asText("vía"),
          periodicidad: asText("periodicidad") || asText("frecuencia"),
          instruccion: asText("instruccion") || asText("instrucción"),
        };
      })
    : [];
  return {
    idioma: normalizeLanguageCode(text("idioma")) || idioma,
    idioma_nombre: text("idioma_nombre") || nombreIdioma(idioma),
    titulo: text("titulo", "título") || (idioma === "es" ? "Indicaciones para el paciente" : "Patient instructions"),
    resumen: text("resumen") || nota?.resumen || "",
    indicaciones: text("indicaciones", "instrucciones") || nota?.plan || "",
    medicamentos: meds.length ? meds : (nota?.tratamiento ?? []).map((row) => ({ ...row, instruccion: "" })),
    alarmas: text("alarmas", "advertencias"),
    seguimiento: text("seguimiento") || nota?.seguimiento || "",
  };
}

export function recetaDesdeNota(nota: NotaClinica, idioma: string): RecetaPaciente {
  return {
    idioma,
    idioma_nombre: nombreIdioma(idioma),
    titulo: idioma === "es" ? "Indicaciones para el paciente" : "Patient instructions",
    resumen: nota.resumen,
    indicaciones: nota.plan,
    medicamentos: (nota.tratamiento ?? []).map((row) => ({ ...row, instruccion: "" })),
    alarmas: "",
    seguimiento: nota.seguimiento,
  };
}

export function detectarIdiomaTexto(text: string): string {
  const sample = ` ${text.toLowerCase()} `;
  const scores: Array<[string, string[]]> = [
    ["es", [" el ", " la ", " que ", " de ", " dolor ", " paciente ", " años ", " consulta "]],
    ["en", [" the ", " and ", " patient ", " pain ", " with ", " years ", " appointment "]],
    ["fr", [" le ", " les ", " une ", " douleur ", " patient ", " avec "]],
    ["pt", [" o ", " uma ", " que ", " dor ", " paciente ", " para "]],
    ["de", [" der ", " die ", " und ", " schmerz ", " patient "]],
    ["it", [" il ", " che ", " dolore ", " paziente ", " della "]],
  ];
  let best = "es";
  let bestScore = 0;
  for (const [code, words] of scores) {
    const score = words.reduce((sum, word) => sum + (sample.split(word).length - 1), 0);
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return best;
}

function extraerIdentificacion(transcripcion: string): { nombre: string; edad: string; ocupacion: string } {
  const edadMatch = transcripcion.match(
    /\b(\d{1,3})\s*(?:años?|anios?|year(?:s)?\s*old)\b/i
  );
  const ocupacionMatch = transcripcion.match(
    /\b(?:ocupaci[oó]n|trabajo|oficio|me dedico a|soy)\s+(?:de\s+)?([a-záéíóúñü\s]{3,40})/i
  );
  const nombreMatch = transcripcion.match(
    /\b(?:me llamo|mi nombre es|paciente(?:\s+se llama)?|se llama)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü]+){0,3})/i
  );
  return {
    nombre: nombreMatch?.[1]?.trim() ?? "",
    edad: edadMatch ? `${edadMatch[1]} años` : "",
    ocupacion: ocupacionMatch?.[1]?.trim().replace(/[.,;].*$/, "") ?? "",
  };
}

function orKnown(value: string, known?: string): string {
  if (value !== NO_MENCIONADO) return value;
  return known?.trim() || NO_MENCIONADO;
}

function parseTratamiento(raw: unknown): IndicacionTerapeutica[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const asText = (key: string) => (typeof row[key] === "string" ? row[key].trim() : "");
    return {
      medicamento: asText("medicamento") || asText("nombre"),
      dosis: asText("dosis"),
      via: asText("via") || asText("vía"),
      periodicidad: asText("periodicidad") || asText("frecuencia"),
    };
  });
}

function fallbackNota(
  transcripcion: string,
  entities: ReturnType<typeof extractClinicalEntities>,
  pacienteConocido = "",
  datos: DatosMedico = {}
): NotaClinica {
  const orEmpty = (value: string) => value.trim() || NO_MENCIONADO;
  const id = extraerIdentificacion(transcripcion);
  const sello = ahoraMexico();
  const nota: NotaClinica = {
    nombre_paciente: orEmpty(id.nombre || pacienteConocido),
    edad: orEmpty(id.edad),
    sexo: orEmpty(datos.sexo ?? ""),
    domicilio: orEmpty(datos.domicilio ?? ""),
    ocupacion: orEmpty(id.ocupacion),
    fecha: sello.fecha,
    hora: sello.hora,
    medico_nombre: orEmpty(datos.medicoNombre ?? ""),
    medico_cedula: orEmpty(datos.medicoCedula ?? ""),
    medico_especialidad: orEmpty(datos.medicoEspecialidad ?? ""),
    motivo_consulta: orEmpty(entities.chief_complaint),
    padecimiento_actual: orEmpty(entities.symptoms.join(" ")),
    interrogatorio: NO_MENCIONADO,
    antecedentes_personales: NO_MENCIONADO,
    antecedentes_quirurgicos: orEmpty(entities.procedures.join("\n")),
    medicamentos: orEmpty(entities.medications.join("\n")),
    alergias: orEmpty(entities.allergies.join("\n")),
    antecedentes_familiares: orEmpty(entities.family_history_mentions.join("\n")),
    antecedentes_sociales: orEmpty(entities.social_history_mentions.join("\n")),
    exploracion_fisica: orEmpty(entities.exam_findings.join("\n")),
    estudios: NO_MENCIONADO,
    diagnostico_presuntivo: orEmpty(entities.diagnoses.join("\n")),
    diagnosticos_diferenciales: NO_MENCIONADO,
    diagnostico: orEmpty(entities.diagnoses.join("\n")),
    pronostico: NO_MENCIONADO,
    plan: orEmpty(entities.plan_items.join("\n")),
    tratamiento: [],
    seguimiento: orEmpty(entities.follow_up.join("\n")),
    notas_evolucion: NO_MENCIONADO,
    resumen: "",
    campos_inciertos: ["redaccion_ia_no_disponible"],
    secciones_faltantes: [],
    sello_responsable: "",
  };
  nota.resumen = transcripcion.trim().length < 40
    ? "Transcripción demasiado breve para redactar un resumen clínico confiable."
    : buildResumen(nota);
  nota.secciones_faltantes = TEXT_KEYS.filter((key) => nota[key] === NO_MENCIONADO);
  return aplicarSelloLegal(nota, datos);
}

export function nombreDesdeNota(nota: NotaClinica, fallback: string): string {
  if (nota.nombre_paciente && nota.nombre_paciente !== NO_MENCIONADO) return nota.nombre_paciente;
  if (fallback && fallback !== "Paciente sin identificar") return fallback;
  return fallback || "Paciente sin identificar";
}

async function completarNotaNom004(
  env: Env,
  nota: NotaClinica,
  transcripcion: string,
  contextoExpediente: string
): Promise<NotaClinica> {
  const dictamen = validarNotaNom004(nota);
  if (dictamen.cumple) return nota;

  try {
    const raw = await groqChatJson(env, [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `La nota preliminar NO cumple NOM-004-SSA3-2012. Completa SOLO con lo dicho en la transcripción o en el expediente maestro. No inventes.
Faltantes: ${dictamen.guia.join("; ")}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

NOTA PRELIMINAR:
${JSON.stringify(nota)}

TRANSCRIPCIÓN:
${transcripcion}

Devuelve SOLO el JSON. Puedes devolver nota_medica_espanol o la nota plana. La nota debe seguir en español.`,
      },
    ]);
    const notaRaw = asObject(raw.nota_medica_espanol) ?? asObject(raw.nota) ?? raw;
    const reparada = normalizeNota(notaRaw, transcripcion, nota.nombre_paciente);
    reparada.medico_nombre = nota.medico_nombre;
    reparada.medico_cedula = nota.medico_cedula;
    reparada.medico_especialidad = nota.medico_especialidad;
    reparada.fecha = nota.fecha;
    reparada.hora = nota.hora;
    return aplicarSelloLegal(reparada, {
      medicoNombre: nota.medico_nombre,
      medicoCedula: nota.medico_cedula,
      medicoEspecialidad: nota.medico_especialidad,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "nota_nom004_repair_failed",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    return nota;
  }
}

function buildResumen(nota: NotaClinica): string {
  const id = [
    nota.nombre_paciente !== NO_MENCIONADO ? nota.nombre_paciente : "",
    nota.edad !== NO_MENCIONADO ? nota.edad : "",
    nota.ocupacion !== NO_MENCIONADO ? nota.ocupacion : "",
  ].filter(Boolean);
  const parts = [
    id.length ? `Paciente: ${id.join(", ")}` : "",
    nota.motivo_consulta !== NO_MENCIONADO ? `Motivo: ${nota.motivo_consulta}` : "",
    nota.diagnostico !== NO_MENCIONADO ? `Diagnóstico: ${nota.diagnostico}` : "",
    nota.plan !== NO_MENCIONADO ? `Plan: ${nota.plan}` : "",
  ].filter(Boolean);
  return parts.join(". ") || "Consulta documentada; faltan datos clínicos suficientes para un resumen.";
}
