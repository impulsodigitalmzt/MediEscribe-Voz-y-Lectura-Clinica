import { clipTranscript } from "./audio";
import { groqChatJson, normalizeLanguageCode } from "./groq";
import { validarNotaNom004 } from "./guardia-legal";
import type {
  DatosMedico,
  DocumentacionConsulta,
  IndicacionTerapeutica,
  NotaClinica,
  RecetaPaciente,
  SignosVitales,
} from "./nota-types";
import { vacioSignosVitales } from "./nota-types";

export type {
  DatosMedico,
  DocumentacionConsulta,
  IndicacionTerapeutica,
  NotaClinica,
  RecetaPaciente,
  SignosVitales,
} from "./nota-types";
export { vacioSignosVitales } from "./nota-types";

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

const SYSTEM_PROMPT = `Eres el motor de documentación clínica de MediEscribe. NO transcribas: SINTETIZA y ORDENA la consulta en SOAP alineado a NOM-004-SSA3-2012.

MISIÓN: del audio/texto extrae solo hechos clínicos, redáctalos en español médico profesional y rellénalos en JSON. Cada campo es un tipo de dato distinto.

SALIDA: un solo JSON válido (sin markdown) con:
- idioma_detectado (ISO 639-1)
- nota_medica_espanol (objeto, SIEMPRE español clínico)
- receta_paciente_nativo (objeto, idioma del paciente)

nota_medica_espanol DEBE incluir:

soap: {
  subjetivo: síntesis S (motivo + HEA + interrogatorio pertinente, 3-8 frases),
  objetivo: síntesis O (vitales + exploración + estudios mencionados),
  analisis: síntesis A (impresión diagnóstica, razonamiento breve, diferenciales si aplica),
  plan: síntesis P (tratamiento, estudios, medidas, seguimiento)
}

Campos NOM-004 (obligatorios, distintos entre sí):
- motivo_consulta: 1-2 frases. NUNCA el relato completo.
- padecimiento_actual: HEA (inicio, cronología, síntomas, factores, evolución).
- interrogatorio: dirigido / revisión por sistemas. Si no hubo: indícalo.
- exploracion_fisica: hallazgos. Si no se exploró: "No se documentó exploración física en la transcripción."
- signos_vitales: objeto con strings (vacío si no se dijeron): ta_sistolica, ta_diastolica, temperatura, fc, fr, spo2, peso, talla, imc, glucosa. Extrae números si el médico los dictó (p. ej. "tensión 120/80", "sat 98"). Calcula imc si hay peso (kg) y talla (cm).
- diagnostico: impresión diagnóstica. No copies el dictado.
- diagnostico_cie10: código CIE-10 más probable del diagnóstico verbalizado (p. ej. "M54.5"). Inferible; no inventes un cuadro clínico distinto.
- diagnostico_presuntivo, diagnosticos_diferenciales, pronostico
- plan / plan_tratamiento: terapéutica, no farmacológico y control.
- tratamiento: array {medicamento, dosis, via, periodicidad} SOLO fármacos indicados ahora. Estructura estricta.
- solicitudes_estudio: array de strings (labs, imagen). También resume en "estudios".
- medicamentos: texto de fármacos actuales o indicados.
- resumen: 2-4 oraciones (motivo, dx+CIE-10, plan). NUNCA transcripción cruda.
- alergias, antecedentes_personales, seguimiento si se mencionaron.

PROHIBIDO:
- Copiar la transcripción en cualquier campo.
- Pegar el mismo párrafo en dos campos.
- Inventar síntomas, signos, dosis o estudios no dichos.
- Devolver texto plano.

EJEMPLO CORRECTO: motivo "Dolor lumbar crónico"; padecimiento "3 meses, 6/10, empeora al estar de pie"; diagnostico "Lumbalgia (CIE-10: M54.5)"; diagnostico_cie10 "M54.5"; tratamiento [{medicamento:"Naproxeno",dosis:"500 mg",via:"oral",periodicidad:"cada 12 horas"}].

receta_paciente_nativo: indicaciones claras para el paciente, no copies la nota.`;

const CAMPOS_NARRATIVOS = [
  "motivo_consulta",
  "padecimiento_actual",
  "interrogatorio",
  "antecedentes_personales",
  "exploracion_fisica",
  "diagnostico",
  "pronostico",
  "plan",
  "medicamentos",
  "notas_evolucion",
  "resumen",
] as const;

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

function normalizarComparacion(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[no mencionado\]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esCopiaDeTranscripcion(campo: string, transcripcion: string): boolean {
  const a = normalizarComparacion(campo);
  const b = normalizarComparacion(transcripcion);
  if (!a || a === normalizarComparacion(NO_MENCIONADO)) return false;
  if (a === b) return true;
  if (transcripcion.trim().length > 80 && campo.trim().length >= transcripcion.trim().length * 0.8) {
    return true;
  }
  return false;
}

function sanitizarNotaContraTranscripcion(nota: NotaClinica, transcripcion: string): NotaClinica {
  const next = { ...nota };
  for (const key of CAMPOS_NARRATIVOS) {
    if (esCopiaDeTranscripcion(next[key], transcripcion)) {
      next[key] = NO_MENCIONADO;
    }
  }
  if (!next.resumen || next.resumen === NO_MENCIONADO || esCopiaDeTranscripcion(next.resumen, transcripcion)) {
    next.resumen = buildResumen(next);
  }
  next.secciones_faltantes = TEXT_KEYS.filter((key) => next[key] === NO_MENCIONADO);
  return next;
}

function textoPlano(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function aplanarSoap(raw: Record<string, unknown>): Record<string, unknown> {
  const soap = asObject(raw.soap);
  if (!soap) return raw;
  const next = { ...raw };
  const subjetivo = textoPlano(soap.subjetivo);
  const objetivo = textoPlano(soap.objetivo);
  const analisis = textoPlano(soap.analisis) || textoPlano(soap.análisis);
  const planSoap = textoPlano(soap.plan);
  if (!textoPlano(next.padecimiento_actual) && subjetivo) next.padecimiento_actual = subjetivo;
  if (!textoPlano(next.motivo_consulta) && subjetivo) {
    const corta = subjetivo.split(/[.!?]/)[0]?.trim() || subjetivo;
    next.motivo_consulta = corta.slice(0, 220);
  }
  if (!textoPlano(next.exploracion_fisica) && objetivo) next.exploracion_fisica = objetivo;
  if (!textoPlano(next.diagnostico) && analisis) next.diagnostico = analisis;
  if (!textoPlano(next.plan) && !textoPlano(next.plan_tratamiento) && planSoap) next.plan = planSoap;
  return next;
}

function objetoNotaDesdeRespuesta(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = asObject(raw.nota_medica_espanol) ?? asObject(raw.nota);
  if (nested) return aplanarSoap(nested);
  if (
    typeof raw.motivo_consulta === "string" ||
    typeof raw.padecimiento_actual === "string" ||
    typeof raw.plan_tratamiento === "string" ||
    asObject(raw.soap)
  ) {
    return aplanarSoap(raw);
  }
  return {};
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
    signos_vitales: vacioSignosVitales(),
    estudios: "",
    solicitudes_estudio: [],
    diagnostico_presuntivo: "",
    diagnosticos_diferenciales: "",
    diagnostico: "",
    diagnostico_cie10: "",
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
  const clipped = clipTranscript(transcripcion, 3500);
  const conocido =
    pacienteConocido && pacienteConocido !== "Paciente sin identificar" ? pacienteConocido : "";
  const idiomaHint = normalizeLanguageCode(idiomaWhisper) || detectarIdiomaTexto(clipped);
  const nombreNativo = nombreIdioma(idiomaHint || "es");

  const raw = await groqChatJson(env, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Sintetiza esta consulta en SOAP + NOM-004-SSA3. No transcribas: ordena motivo, HEA, exploración, signos vitales estructurados, diagnóstico con CIE-10, receta estructurada y plan.

Especialidad: ${especialidad}
Idioma de la receta (receta_paciente_nativo e idioma_detectado): ${idiomaHint || "desconocido — detéctalo"} (${nombreNativo})
${conocido ? `Nombre del expediente (nombre_paciente): ${conocido}` : "Extrae identificación solo si se dijo."}
${datos.sexo ? `Sexo conocido: ${datos.sexo}` : ""}
${datos.domicilio ? `Domicilio conocido: ${datos.domicilio}` : ""}
${datos.medicoNombre ? `Médico tratante: ${datos.medicoNombre}` : ""}
${datos.medicoCedula ? `Cédula profesional: ${datos.medicoCedula}` : ""}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

No copies el dictado completo en las casillas. Un campo = un tipo de dato clínico.

TRANSCRIPCIÓN:
${clipped}`,
    },
  ]);
  const parsed = parseDocumentacionDual(raw, clipped, conocido, datos, idiomaHint);
  parsed.nota = sanitizarNotaContraTranscripcion(parsed.nota, clipped);
  parsed.nota = await completarNotaNom004(env, parsed.nota, clipped, contextoExpediente);
  parsed.nota = sanitizarNotaContraTranscripcion(parsed.nota, clipped);
  console.log(
    JSON.stringify({
      event: "nota_clinica_ok",
      transcriptChars: clipped.length,
      motivoChars: parsed.nota.motivo_consulta.length,
      padecimientoChars: parsed.nota.padecimiento_actual.length,
      diagnosticoChars: parsed.nota.diagnostico.length,
      exploracionChars: parsed.nota.exploracion_fisica.length,
      planChars: parsed.nota.plan.length,
      medicamentosChars: parsed.nota.medicamentos.length,
      pronosticoChars: parsed.nota.pronostico.length,
      motivoEqualsTranscript: parsed.nota.motivo_consulta.trim() === clipped.trim(),
      padecimientoEqualsTranscript: parsed.nota.padecimiento_actual.trim() === clipped.trim(),
      tieneCie10: Boolean(parsed.nota.diagnostico_cie10),
      vitalesLlenos: Object.values(parsed.nota.signos_vitales).filter(Boolean).length,
      recetas: parsed.nota.tratamiento.length,
    })
  );
  return parsed;
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
  let tratamiento = parseTratamiento(raw.tratamiento);
  if (tratamiento.length === 0) {
    tratamiento = parseTratamiento(raw.medicamentos);
  }

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
    medicamentos: textoMedicamentos(raw),
    alergias: text("alergias"),
    antecedentes_familiares: text("antecedentes_familiares"),
    antecedentes_sociales: text("antecedentes_sociales"),
    exploracion_fisica: text("exploracion_fisica"),
    signos_vitales: parseSignosVitales(raw, text("exploracion_fisica")),
    estudios: text("estudios"),
    solicitudes_estudio: parseSolicitudesEstudio(raw),
    diagnostico_presuntivo: text("diagnostico_presuntivo"),
    diagnosticos_diferenciales: text("diagnosticos_diferenciales"),
    diagnostico: textoDiagnostico(raw, text),
    diagnostico_cie10: extraerCie10(raw, text),
    pronostico: text("pronostico", "pronóstico"),
    plan: text("plan_tratamiento", "plan", "tratamiento_plan"),
    tratamiento,
    seguimiento: text("seguimiento"),
    notas_evolucion: text("notas_evolucion", "evolucion"),
    resumen: text("resumen"),
    campos_inciertos: list("campos_inciertos"),
    secciones_faltantes: list("secciones_faltantes"),
    sello_responsable: "",
  };

  if (!nota.estudios || nota.estudios === NO_MENCIONADO) {
    const estudios = nota.solicitudes_estudio.filter(Boolean).join("; ");
    if (estudios) nota.estudios = estudios;
  }
  if (nota.diagnostico !== NO_MENCIONADO && nota.diagnostico_cie10 && !/cie-?10/i.test(nota.diagnostico)) {
    nota.diagnostico = `${nota.diagnostico} (CIE-10: ${nota.diagnostico_cie10})`;
  }

  if (nota.resumen === NO_MENCIONADO) {
    nota.resumen = buildResumen(nota);
  }
  if (nota.secciones_faltantes.length === 0) {
    nota.secciones_faltantes = TEXT_KEYS.filter((key) => nota[key] === NO_MENCIONADO);
  }
  if (transcripcion.trim().length < 40 && !nota.campos_inciertos.includes("transcripcion_corta")) {
    nota.campos_inciertos = [...nota.campos_inciertos, "transcripcion_corta"];
  }
  return sanitizarNotaContraTranscripcion(aplicarSelloLegal(nota, datos), transcripcion);
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
  const notaRaw = objetoNotaDesdeRespuesta(raw);
  const recetaRaw = asObject(raw.receta_paciente_nativo) ?? asObject(raw.receta);
  const idioma =
    normalizeLanguageCode(String(raw.idioma_detectado ?? recetaRaw?.idioma ?? "")) || idiomaHint || "es";
  const nota = normalizeNota(notaRaw, transcripcion, pacienteConocido, datos);
  const receta = recetaRaw ? parseReceta(recetaRaw, idioma, nota) : recetaDesdeNota(nota, idioma);
  receta.idioma = receta.idioma || idioma;
  receta.idioma_nombre = receta.idioma_nombre || nombreIdioma(receta.idioma);
  if (esCopiaDeTranscripcion(receta.resumen, transcripcion)) {
    receta.resumen = nota.resumen !== NO_MENCIONADO ? nota.resumen : "";
  }
  if (esCopiaDeTranscripcion(receta.indicaciones, transcripcion)) {
    receta.indicaciones = nota.plan !== NO_MENCIONADO ? nota.plan : "";
  }
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
  }).filter((row) => row.medicamento);
}

function textoMedicamentos(raw: Record<string, unknown>): string {
  const value = raw.medicamentos ?? raw.medicacion ?? raw.tratamiento_farmacologico;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const lines = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          return [row.medicamento ?? row.nombre, row.dosis, row.via ?? row["vía"], row.periodicidad ?? row.frecuencia]
            .filter((part) => typeof part === "string" && part.trim())
            .join(" ");
        }
        return "";
      })
      .filter(Boolean);
    if (lines.length) return lines.join("\n");
  }
  return NO_MENCIONADO;
}

function campoSigno(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function extraerSignosDeTexto(texto: string): Partial<SignosVitales> {
  const out: Partial<import("./nota-types").SignosVitales> = {};
  const ta = texto.match(/(?:TA|PA|tensi[oó]n(?:\s+arterial)?)[^\d]{0,16}(\d{2,3})\s*[/]\s*(\d{2,3})/i);
  if (ta) {
    out.ta_sistolica = ta[1];
    out.ta_diastolica = ta[2];
  }
  const temp = texto.match(/(?:temp(?:eratura)?|t[°º])[^\d]{0,8}(\d{2}(?:[.,]\d+)?)/i);
  if (temp) out.temperatura = temp[1].replace(",", ".");
  const fc = texto.match(/\b(?:FC|frecuencia\s+card[ií]aca|lpm)[^\d]{0,8}(\d{2,3})/i);
  if (fc) out.fc = fc[1];
  const fr = texto.match(/\b(?:FR|frecuencia\s+respiratoria|rpm)[^\d]{0,8}(\d{1,2})/i);
  if (fr) out.fr = fr[1];
  const spo2 = texto.match(/(?:SpO2|sat(?:uraci[oó]n)?)[^\d]{0,8}(\d{2,3})/i);
  if (spo2) out.spo2 = spo2[1];
  const peso = texto.match(/\bpeso[^\d]{0,8}(\d{2,3}(?:[.,]\d+)?)\s*kg/i);
  if (peso) out.peso = peso[1].replace(",", ".");
  const talla = texto.match(/\b(?:talla|estatura|altura)[^\d]{0,8}(\d{2,3}(?:[.,]\d+)?)\s*cm/i);
  if (talla) out.talla = talla[1].replace(",", ".");
  const glucosa = texto.match(/\bglucosa[^\d]{0,8}(\d{2,3}(?:[.,]\d+)?)/i);
  if (glucosa) out.glucosa = glucosa[1].replace(",", ".");
  return out;
}

function calcularImc(peso: string, talla: string): string {
  const kg = Number.parseFloat(peso.replace(",", "."));
  const cm = Number.parseFloat(talla.replace(",", "."));
  if (!Number.isFinite(kg) || !Number.isFinite(cm) || kg <= 0 || cm <= 0) return "";
  const metros = cm > 3 ? cm / 100 : cm;
  if (metros <= 0) return "";
  return (kg / (metros * metros)).toFixed(2);
}

function parseSignosVitales(raw: Record<string, unknown>, exploracion: string): SignosVitales {
  const source = asObject(raw.signos_vitales) ?? asObject(raw.vitales) ?? asObject(raw.signos) ?? {};
  const fromText = extraerSignosDeTexto(`${exploracion} ${textoPlano(raw.objetivo)}`);
  const signos = vacioSignosVitales();
  signos.ta_sistolica = campoSigno(source, "ta_sistolica", "ta_sis", "sistolica") || fromText.ta_sistolica || "";
  signos.ta_diastolica = campoSigno(source, "ta_diastolica", "ta_dia", "diastolica") || fromText.ta_diastolica || "";
  signos.temperatura = campoSigno(source, "temperatura", "temp") || fromText.temperatura || "";
  signos.fc = campoSigno(source, "fc", "frecuencia_cardiaca", "pulso") || fromText.fc || "";
  signos.fr = campoSigno(source, "fr", "frecuencia_respiratoria") || fromText.fr || "";
  signos.spo2 = campoSigno(source, "spo2", "saturacion", "sat") || fromText.spo2 || "";
  signos.peso = campoSigno(source, "peso", "weight") || fromText.peso || "";
  signos.talla = campoSigno(source, "talla", "estatura", "altura") || fromText.talla || "";
  signos.imc = campoSigno(source, "imc", "bmi") || calcularImc(signos.peso, signos.talla);
  signos.glucosa = campoSigno(source, "glucosa", "glucose") || fromText.glucosa || "";
  return signos;
}

function fusionarSignos(prev?: SignosVitales, next?: SignosVitales): SignosVitales {
  const merged = vacioSignosVitales();
  const a = prev ?? vacioSignosVitales();
  const b = next ?? vacioSignosVitales();
  (Object.keys(merged) as Array<keyof SignosVitales>).forEach((key) => {
    merged[key] = b[key] || a[key] || "";
  });
  if (!merged.imc) merged.imc = calcularImc(merged.peso, merged.talla);
  return merged;
}

function parseSolicitudesEstudio(raw: Record<string, unknown>): string[] {
  const value = raw.solicitudes_estudio ?? raw.estudios_solicitados ?? raw.ordenes;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function extraerCie10(
  raw: Record<string, unknown>,
  text: (...keys: string[]) => string
): string {
  const fromField = text("diagnostico_cie10", "cie10", "cie_10", "codigo_cie10", "codigo_cie_10");
  if (fromField !== NO_MENCIONADO) {
    const code = fromField.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?/i);
    return code ? code[0].toUpperCase() : fromField.replace(/^CIE-?10\s*:?\s*/i, "").trim();
  }
  const diagnostico = text("diagnostico", "diagnóstico");
  const match = diagnostico.match(/CIE-?10\s*:?\s*([A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?)/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function textoDiagnostico(
  raw: Record<string, unknown>,
  text: (...keys: string[]) => string
): string {
  const diagnostico = text("diagnostico", "diagnóstico");
  const cie = text("cie10", "cie_10", "codigo_cie10", "codigo_cie_10", "diagnostico_cie10");
  if (diagnostico === NO_MENCIONADO) return diagnostico;
  if (cie === NO_MENCIONADO) return diagnostico;
  if (/cie-?10/i.test(diagnostico) || diagnostico.includes(cie)) return diagnostico;
  return `${diagnostico} (CIE-10: ${cie})`;
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
        content: `Completa SOLO los faltantes NOM-004. Sintetiza SOAP; extrae signos_vitales, diagnostico_cie10 y tratamiento estructurado si constan en el dictado.
Si un dato no está en la transcripción, descríbelo como no documentado. PROHIBIDO pegar el dictado completo.
Faltantes: ${dictamen.guia.join("; ")}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

NOTA PRELIMINAR (conserva lo que ya está bien):
${JSON.stringify(nota)}

TRANSCRIPCIÓN (solo para extraer frases puntuales):
${transcripcion}

Devuelve JSON con nota_medica_espanol. Español clínico. Cada campo distinto.`,
      },
    ]);
    const notaRaw = objetoNotaDesdeRespuesta(raw);
    const reparada = normalizeNota(notaRaw, transcripcion, nota.nombre_paciente);
    reparada.medico_nombre = nota.medico_nombre;
    reparada.medico_cedula = nota.medico_cedula;
    reparada.medico_especialidad = nota.medico_especialidad;
    reparada.fecha = nota.fecha;
    reparada.hora = nota.hora;
    reparada.signos_vitales = fusionarSignos(nota.signos_vitales, reparada.signos_vitales);
    if (!reparada.tratamiento.length) reparada.tratamiento = nota.tratamiento;
    if (!reparada.diagnostico_cie10) reparada.diagnostico_cie10 = nota.diagnostico_cie10;
    if (!reparada.solicitudes_estudio.length) reparada.solicitudes_estudio = nota.solicitudes_estudio;
    return sanitizarNotaContraTranscripcion(
      aplicarSelloLegal(reparada, {
        medicoNombre: nota.medico_nombre,
        medicoCedula: nota.medico_cedula,
        medicoEspecialidad: nota.medico_especialidad,
      }),
      transcripcion
    );
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
