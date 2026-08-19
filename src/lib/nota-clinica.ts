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
Analizas la transcripción de UNA consulta y extraes datos hacia campos NOM-004-SSA3-2012.

SALIDA: un solo JSON con:
- idioma_detectado (ISO 639-1)
- nota_medica_espanol (objeto, SIEMPRE español clínico)
- receta_paciente_nativo (objeto, idioma del paciente)

PROHIBIDO:
- Copiar la transcripción completa en cualquier campo.
- Pegar el mismo párrafo en dos o más campos.
- Inventar datos no dichos.
- Llenar un campo vacío con todo el relato "por si acaso".

CÓMO LLENAR nota_medica_espanol (cada campo = SOLO su contenido, 1 a 4 oraciones):
- motivo_consulta: razón breve de la visita (una frase). NO el relato completo.
- padecimiento_actual: historia de la enfermedad actual (inicio, tiempo, síntomas, evolución). Distinto del motivo.
- interrogatorio: respuestas dirigidas, ROS. Si no hubo, "${NO_MENCIONADO}".
- exploracion_fisica: signos vitales y hallazgos. Si no se exploró, "${NO_MENCIONADO}".
- diagnostico: impresión diagnóstica breve. NO copies el padecimiento.
- pronostico: solo si se dijo. Si no, "${NO_MENCIONADO}".
- plan: indicaciones (estudios, medidas, cita).
- tratamiento: array {medicamento, dosis, via, periodicidad}. [] si no hay fármacos.
- medicamentos: fármacos que YA toma el paciente (antecedente), no el plan de hoy.
- alergias, antecedentes_*: solo lo mencionado.
- resumen: 2-4 oraciones (id, motivo, dx, plan). NO la transcripción cruda.
- Si un dato no se mencionó: exactamente "${NO_MENCIONADO}".

EJEMPLO DE ERROR: motivo_consulta = padecimiento_actual = diagnostico = todo el dictado.
EJEMPLO CORRECTO: motivo_consulta "Cefalea de 3 días"; padecimiento_actual "Inicio gradual, 7/10, sin fiebre"; diagnostico "Cefalea tensional"; exploracion_fisica "${NO_MENCIONADO}" si no se exploró.

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
  if (a.length < 48 || b.length < 48) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return longer.includes(shorter) && shorter.length / longer.length >= 0.72;
}

function oracionesClinicas(texto: string): string[] {
  return texto
    .split(/(?<=[.!?…;:])\s+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 8);
}

function juntarOraciones(items: string[], max = 4): string {
  const unique: string[] = [];
  for (const item of items) {
    if (!unique.includes(item)) unique.push(item);
  }
  return unique.slice(0, max).join(" ").trim();
}

function tomarOraciones(oraciones: string[], patron: RegExp): string[] {
  return oraciones.filter((item) => patron.test(item));
}

function extraerSeccionesNom004(transcripcion: string): Partial<NotaClinica> {
  const ss = oracionesClinicas(transcripcion);
  const motivoHits = tomarOraciones(
    ss,
    /motivo|viene por|consulta por|acude por|me duele|dolor de|qu[eé] le trae|aqu[ií] por|cefalea|tos|fiebre/i
  );
  const padecimientoHits = tomarOraciones(
    ss,
    /desde hace|hace \d|inici[oó]|comenz[oó]|evoluci[oó]n|se acompa[nñ]a|empeor|mejor[oó]|intensidad|nause|diarrea|padecimiento|s[ií]ntoma/i
  );
  const exploracionHits = tomarOraciones(
    ss,
    /exploraci[oó]n|signos vitales|\bta\b|\bfc\b|\bfr\b|temperatura|abdomen|pulm[oó]n|auscult|palpaci|blando|tenso|ruidos|saturaci|mmhg/i
  );
  const diagnosticoHits = tomarOraciones(
    ss,
    /diagn[oó]stic|impresi[oó]n|impresiona|parece|cuadro de|sugestivo|\bdx\b|gastritis|infecci[oó]n|migra[nñ]a/i
  );
  const planHits = tomarOraciones(
    ss,
    /plan|tratamiento|indicar|recetar|prescri|tomar|indicaci[oó]n|cada \d|v[ií]a oral|\bmg\b|referir|solicitar|paracetamol|ibuprofeno|omeprazol/i
  );
  const alergiaHits = tomarOraciones(ss, /alerg/i);
  const medicamentoHits = tomarOraciones(ss, /medicamento|est[aá] tomando|tableta|c[aá]psula|toma /i);
  const pronosticoHits = tomarOraciones(ss, /pron[oó]stic|reservado|bueno para la vida/i);
  const seguimientoHits = tomarOraciones(ss, /seguimiento|regresar|cita|volver|control en|en \d+\s*d[ií]as/i);

  const motivo = juntarOraciones(motivoHits, 2) || ss[0] || "";
  const padecimiento = juntarOraciones(
    padecimientoHits.filter((item) => item !== motivo),
    4
  ) || juntarOraciones(ss.slice(1, 4).filter((item) => item !== motivo), 3);
  const exploracion = juntarOraciones(exploracionHits, 3);
  const diagnostico = juntarOraciones(diagnosticoHits.filter((item) => item !== motivo && item !== padecimiento), 2);
  const plan = juntarOraciones(planHits, 3);

  return {
    motivo_consulta: motivo,
    padecimiento_actual: padecimiento && padecimiento !== motivo ? padecimiento : "",
    exploracion_fisica: exploracion,
    diagnostico,
    plan,
    alergias: juntarOraciones(alergiaHits, 2),
    medicamentos: juntarOraciones(medicamentoHits.filter((item) => !planHits.includes(item)), 3),
    pronostico: juntarOraciones(pronosticoHits, 1),
    seguimiento: juntarOraciones(seguimientoHits, 2),
  };
}

function sanitizarNotaContraTranscripcion(nota: NotaClinica, transcripcion: string): NotaClinica {
  const next = { ...nota };
  const extraido = extraerSeccionesNom004(transcripcion);
  let copias = 0;
  for (const key of CAMPOS_NARRATIVOS) {
    if (esCopiaDeTranscripcion(next[key], transcripcion)) {
      copias += 1;
      const reemplazo = extraido[key];
      next[key] = typeof reemplazo === "string" && reemplazo.trim() ? reemplazo.trim() : NO_MENCIONADO;
    }
  }
  const valores = CAMPOS_NARRATIVOS.map((key) => normalizarComparacion(next[key])).filter(
    (value) => value.length > 48 && value !== normalizarComparacion(NO_MENCIONADO)
  );
  const duplicadosInternos =
    valores.length >= 3 && valores.filter((value) => value === valores[0]).length >= 3;
  if (duplicadosInternos || copias >= 3) {
    next.motivo_consulta = extraido.motivo_consulta || next.motivo_consulta;
    next.padecimiento_actual =
      extraido.padecimiento_actual && extraido.padecimiento_actual !== extraido.motivo_consulta
        ? extraido.padecimiento_actual
        : NO_MENCIONADO;
    next.exploracion_fisica = extraido.exploracion_fisica || NO_MENCIONADO;
    next.diagnostico = extraido.diagnostico || NO_MENCIONADO;
    next.plan = extraido.plan || NO_MENCIONADO;
    next.pronostico = extraido.pronostico || NO_MENCIONADO;
    next.interrogatorio = NO_MENCIONADO;
    next.notas_evolucion = NO_MENCIONADO;
    if (esCopiaDeTranscripcion(next.resumen, transcripcion)) {
      next.resumen = "";
    }
  }
  if (!next.resumen || next.resumen === NO_MENCIONADO || esCopiaDeTranscripcion(next.resumen, transcripcion)) {
    next.resumen = buildResumen(next);
  }
  next.secciones_faltantes = TEXT_KEYS.filter((key) => next[key] === NO_MENCIONADO);
  return next;
}

function objetoNotaDesdeRespuesta(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = asObject(raw.nota_medica_espanol) ?? asObject(raw.nota);
  if (nested) return nested;
  if (typeof raw.motivo_consulta === "string" || typeof raw.padecimiento_actual === "string") return raw;
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
Idioma de la receta (receta_paciente_nativo e idioma_detectado): ${idiomaHint || "desconocido — detéctalo"} (${nombreNativo})
${conocido ? `Nombre del expediente (nombre_paciente): ${conocido}` : "Extrae identificación solo si se dijo."}
${datos.sexo ? `Sexo conocido: ${datos.sexo}` : ""}
${datos.domicilio ? `Domicilio conocido: ${datos.domicilio}` : ""}
${datos.medicoNombre ? `Médico tratante: ${datos.medicoNombre}` : ""}
${datos.medicoCedula ? `Cédula profesional: ${datos.medicoCedula}` : ""}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

TAREA: analiza la transcripción y DISTRIBUYE cada dato en su campo NOM-004.
No copies el dictado completo en las casillas. Un campo = un tipo de dato.
Si no se dijo, usa "${NO_MENCIONADO}".

TRANSCRIPCIÓN:
${clipped}

JSON con idioma_detectado, nota_medica_espanol y receta_paciente_nativo.`,
      },
    ]);
    const parsed = parseDocumentacionDual(raw, clipped, conocido, datos, idiomaHint);
    parsed.nota = sanitizarNotaContraTranscripcion(parsed.nota, clipped);
    parsed.nota = await completarNotaNom004(env, parsed.nota, clipped, contextoExpediente);
    parsed.nota = sanitizarNotaContraTranscripcion(parsed.nota, clipped);
    return parsed;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "nota_clinica_fallback",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    const nota = sanitizarNotaContraTranscripcion(
      fallbackNota(clipped, entities, conocido, datos),
      clipped
    );
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
  const secciones = extraerSeccionesNom004(transcripcion);
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
    motivo_consulta: orEmpty(secciones.motivo_consulta || entities.chief_complaint),
    padecimiento_actual: orEmpty(secciones.padecimiento_actual || entities.symptoms.join(" ")),
    interrogatorio: NO_MENCIONADO,
    antecedentes_personales: NO_MENCIONADO,
    antecedentes_quirurgicos: orEmpty(entities.procedures.join("\n")),
    medicamentos: orEmpty(secciones.medicamentos || entities.medications.join("\n")),
    alergias: orEmpty(secciones.alergias || entities.allergies.join("\n")),
    antecedentes_familiares: orEmpty(entities.family_history_mentions.join("\n")),
    antecedentes_sociales: orEmpty(entities.social_history_mentions.join("\n")),
    exploracion_fisica: orEmpty(secciones.exploracion_fisica || entities.exam_findings.join("\n")),
    estudios: NO_MENCIONADO,
    diagnostico_presuntivo: orEmpty(entities.diagnoses.join("\n")),
    diagnosticos_diferenciales: NO_MENCIONADO,
    diagnostico: orEmpty(secciones.diagnostico || entities.diagnoses.join("\n")),
    pronostico: orEmpty(secciones.pronostico || ""),
    plan: orEmpty(secciones.plan || entities.plan_items.join("\n")),
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
        content: `Completa SOLO los faltantes NOM-004 con fragmentos ESPECÍFICOS de la transcripción.
PROHIBIDO pegar la transcripción completa en un campo. Si no hay dato, usa "${NO_MENCIONADO}".
Faltantes: ${dictamen.guia.join("; ")}
${contextoExpediente ? `\n${contextoExpediente}\n` : ""}

NOTA PRELIMINAR (conserva lo que ya está bien y corto):
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
