import { clipTranscript } from "./audio";
import { groqChatJson } from "./groq";
import { AppError } from "./errors";
import { estaVacio, Nom004Error, type FaltanteNom004 } from "./guardia-legal";
import type { IndicacionTerapeutica, NotaClinica } from "./nota-types";
import { textoCampoClinico } from "./texto-campo";

export const SOAP_SYSTEM_PROMPT = `Eres el motor de documentación clínica de MediEscribe (NOM-004-SSA3). Extraes ÚNICAMENTE hechos médicos de la transcripción y los colocas en JSON.

FILTRO DE RUIDO (obligatorio):
- Ignora por completo saludos, despedidas, charla social, pruebas de micrófono o audio, comentarios técnicos sobre si el dictado «ya funciona», «ya quedó» o «ya trabaja bien», muletillas y cualquier frase ajena a la consulta.
- Ejemplos a descartar: «hola», «buenos días», «buenas tardes», «prueba de micrófono», «uno dos tres», «¿me escuchas?», «ya trabaja bien», «ya quedó», «testing», «ya veo que sí».
- Esas frases NO deben aparecer en ningún campo, ni siquiera resumidas o parafraseadas.

ASIGNACIÓN SEMÁNTICA:
- subjetivo: solo motivo de consulta, síntomas, padecimiento actual e historia clínica referida. Si no hay dato médico, "".
- objetivo: solo exploración física, signos vitales o hallazgos dictados. Si no se exploró, "".
- analisis: solo diagnóstico, impresión clínica o razonamiento médico dictado. Si no hay, "".
- plan_tratamiento: solo plan, indicaciones o seguimiento dictados. Si no hay, "".
- medicamentos: array de {medicamento, dosis, via, periodicidad} solo si se dictó un fármaco. Si no hay, [].
- diagnostico_cie10: código CIE-10 SOLO si el diagnóstico está dictado o se desprende de hallazgos clínicos explícitos. Si no hay dato, "". NUNCA inventes un código.
- pronostico: solo si el médico lo dictó. Si no, "".

CAMPOS VACÍOS POR DEFECTO:
- Solo si el dictado es saludo, prueba de micrófono o charla sin dato médico, todos los campos van "".
- Si hay información clínica (síntomas, exploración, diagnóstico, plan), LLENA el campo correspondiente con ese contenido médico. No lo dejes vacío.
- Prohibido inventar datos que no estén en el dictado, usar saludos como motivo, o rellenar con frases genéricas.
- No copies saludos. Sí puedes usar el texto clínico del dictado en el campo que le corresponda.

Responde SOLO un objeto JSON con esas llaves.`;

export type SoapClinico = {
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan_tratamiento: string;
  medicamentos: IndicacionTerapeutica[];
  diagnostico_cie10: string;
  pronostico: string;
};

function asText(value: unknown): string {
  return textoCampoClinico(value);
}

const TOKEN_RUIDO = new Set([
  "hola", "hello", "hi", "hey", "buenos", "buen", "buena", "buenas", "dias", "día", "dia",
  "tardes", "noches", "que", "qué", "tal", "como", "cómo", "estas", "estás", "esta", "está",
  "prueba", "microfono", "micrófono", "micro", "audio", "sonido", "testing", "test", "mic",
  "check", "uno", "dos", "tres", "se", "escucha", "escuchas", "me", "oiste", "oíste",
  "ya", "quedo", "quedó", "funciona", "trabaja", "bien", "veo", "si", "sí", "ok", "okay",
  "vale", "listo", "perfecto", "gracias", "el", "la", "lo", "de", "del", "al", "en", "a",
  "y", "o", "que", "sí", "no", "pues", "bueno", "este", "esta", "ah", "eh", "mm", "mmm",
]);

const CLINICO =
  /\b(dolor|duele|fiebre|tos|nause|nauseas|vómit|vomit|mareo|cefalea|diarrea|alerg|asma|hipertens|diabetes|presi[oó]n|glucosa|temperatura|exploraci[oó]n|abdomen|pulm[oó]n|coraz[oó]n|diagn[oó]stic|tratamiento|medicament|recet|s[ií]ntoma|padecimiento|consulta por|acude por|viene por|antecedente|cirug[ií]a|herida|infecci[oó]n|sangrado|disnea|taquicard|edema|lesi[oó]n|fractura|embarazo|gesta|motivo)\b/i;

function normalizarRuido(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function esRuidoNoClinico(texto: string): boolean {
  const t = normalizarRuido(texto);
  if (!t) return true;
  if (CLINICO.test(texto)) return false;
  const tokens = t.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => TOKEN_RUIDO.has(token));
}

export function depurarTextoClinico(texto: string): string {
  const raw = asText(texto);
  if (!raw || esRuidoNoClinico(raw)) return "";
  const partes = raw.split(/(?<=[.!?¿?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  if (partes.length <= 1) return esRuidoNoClinico(raw) ? "" : raw;
  const utiles = partes.filter((parte) => !esRuidoNoClinico(parte));
  return utiles.join(" ").trim();
}

function parseMedicamentos(raw: unknown): IndicacionTerapeutica[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        return { medicamento: item.trim(), dosis: "", via: "", periodicidad: "" };
      }
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const text = (key: string) => (typeof row[key] === "string" ? row[key].trim() : "");
      return {
        medicamento: text("medicamento") || text("nombre"),
        dosis: text("dosis"),
        via: text("via") || text("vía"),
        periodicidad: text("periodicidad") || text("frecuencia"),
      };
    })
    .filter((row) => row.medicamento);
}

export function parseSoapClinico(raw: Record<string, unknown>): SoapClinico {
  const nested =
    raw.soap && typeof raw.soap === "object" && !Array.isArray(raw.soap)
      ? (raw.soap as Record<string, unknown>)
      : raw;
  const cie = asText(raw.diagnostico_cie10) || asText(nested.diagnostico_cie10);
  const soap: SoapClinico = {
    subjetivo: depurarTextoClinico(asText(nested.subjetivo) || asText(raw.subjetivo)),
    objetivo: depurarTextoClinico(asText(nested.objetivo) || asText(raw.objetivo)),
    analisis: depurarTextoClinico(asText(nested.analisis) || asText(nested.análisis) || asText(raw.analisis)),
    plan_tratamiento: depurarTextoClinico(
      asText(nested.plan_tratamiento) || asText(nested.plan) || asText(raw.plan_tratamiento) || asText(raw.plan)
    ),
    medicamentos: parseMedicamentos(raw.medicamentos ?? nested.medicamentos),
    diagnostico_cie10: (cie.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?/i)?.[0] ?? cie).toUpperCase(),
    pronostico: depurarTextoClinico(asText(nested.pronostico) || asText(nested.pronóstico) || asText(raw.pronostico)),
  };
  if (!soap.subjetivo && !soap.objetivo && !soap.analisis && !soap.plan_tratamiento) {
    soap.diagnostico_cie10 = "";
    soap.pronostico = "";
    soap.medicamentos = [];
  }
  return soap;
}

export function validarSoapClinico(soap: SoapClinico): FaltanteNom004[] {
  const faltantes: FaltanteNom004[] = [];
  const push = (campo: string, mensaje: string, numeral: string) => {
    faltantes.push({ campo, mensaje, numeral });
  };
  if (estaVacio(soap.subjetivo)) {
    push("subjetivo", "Falta el subjetivo (motivo y padecimiento actual). Complételo antes de guardar.", "6.1.1");
  }
  if (estaVacio(soap.objetivo)) {
    push("objetivo", "Falta el objetivo (exploración física / signos). Complételo antes de guardar.", "6.1.2 / 6.2.2");
  }
  if (estaVacio(soap.analisis)) {
    push("analisis", "Falta el análisis / diagnóstico. Complételo antes de guardar.", "6.1.4 / 6.2.4");
  }
  if (estaVacio(soap.plan_tratamiento)) {
    push("plan_tratamiento", "Falta el plan de tratamiento. Complételo antes de guardar.", "6.1.6 / 6.2.6");
  }
  if (estaVacio(soap.diagnostico_cie10) || !/^[A-TV-Z][0-9]{2}/i.test(soap.diagnostico_cie10)) {
    push("diagnostico_cie10", "Falta un código CIE-10 válido. Indíquelo para cerrar la nota.", "6.1.4");
  }
  if (estaVacio(soap.pronostico)) {
    push("pronostico", "Falta el pronóstico. Complételo antes de guardar.", "6.1.5 / 6.2.5");
  }
  if (!Array.isArray(soap.medicamentos)) {
    push("medicamentos", "Los medicamentos deben ser un arreglo estructurado (puede ir vacío).", "6.2.6");
  } else {
    soap.medicamentos.forEach((item, index) => {
      if (estaVacio(item.medicamento)) {
        push(`medicamentos.${index}`, `Falta el nombre del medicamento #${index + 1}.`, "6.2.6");
      }
    });
  }
  return faltantes;
}

export function exigirSoapClinico(soap: SoapClinico, nota?: NotaClinica): void {
  const faltantes = validarSoapClinico(soap);
  if (faltantes.length) {
    throw new Nom004Error(faltantes, nota);
  }
}

export function aplicarSoapANota(nota: NotaClinica, soap: SoapClinico): NotaClinica {
  const subjetivo = depurarTextoClinico(soap.subjetivo);
  const objetivo = depurarTextoClinico(soap.objetivo);
  const analisis = depurarTextoClinico(soap.analisis);
  const plan = depurarTextoClinico(soap.plan_tratamiento);
  const motivo = subjetivo.split(/[.!?]/)[0]?.trim().slice(0, 220) || "";
  const diagnostico = soap.diagnostico_cie10 && analisis
    ? analisis.includes(soap.diagnostico_cie10)
      ? analisis
      : `${analisis} (CIE-10: ${soap.diagnostico_cie10})`
    : analisis;
  const medsTexto = soap.medicamentos
    .map((row) => [row.medicamento, row.dosis, row.via, row.periodicidad].filter(Boolean).join(" "))
    .join("\n");
  return {
    ...nota,
    subjetivo,
    objetivo,
    analisis,
    motivo_consulta: motivo,
    padecimiento_actual: subjetivo,
    exploracion_fisica: objetivo,
    diagnostico,
    diagnostico_cie10: analisis ? soap.diagnostico_cie10 : "",
    plan,
    pronostico: depurarTextoClinico(soap.pronostico),
    tratamiento: soap.medicamentos.length ? soap.medicamentos : [],
    medicamentos: medsTexto,
    resumen: [motivo, diagnostico, plan].filter(Boolean).join(". "),
  };
}

export async function sintetizarSoapClinico(env: Env, transcripcion: string): Promise<SoapClinico> {
  const clipped = clipTranscript(transcripcion);
  if (!clipped) {
    throw new AppError(400, "La transcripción no puede estar vacía.", "TRANSCRIPT_EMPTY");
  }
  const raw = await groqChatJson(env, [
    { role: "system", content: SOAP_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Devuelve SOLO JSON con: subjetivo, objetivo, analisis, plan_tratamiento, medicamentos, diagnostico_cie10, pronostico.
medicamentos: array de {medicamento, dosis, via, periodicidad}. Si no hay fármacos, [].
diagnostico_cie10: código CIE-10 únicamente si hay diagnóstico clínico en el dictado; si no, "".
Si el dictado es solo un saludo, charla o prueba de audio, TODOS los campos de texto van "" y medicamentos [].
Si el dictado SÍ tiene dato clínico (dolor, fiebre, síntomas, exploración, plan), llénalo en el campo correcto. Ejemplo de forma: subjetivo/motivo puede ser "Dolor de garganta y fiebre" cuando eso se dictó.
No inventes. No uses saludos como motivo.

TRANSCRIPCIÓN:
${clipped}`,
    },
  ]);
  console.log("GROQ OBJETO SOAP CRUDO:", JSON.stringify(raw));
  const soap = parseSoapClinico(raw);
  console.log("SOAP TRAS PARSEAR:", JSON.stringify(soap));
  return soap;
}
