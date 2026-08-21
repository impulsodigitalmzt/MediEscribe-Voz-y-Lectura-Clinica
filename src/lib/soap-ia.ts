import { clipTranscript } from "./audio";
import { groqChatJson } from "./groq";
import { AppError } from "./errors";
import { estaVacio, Nom004Error, type FaltanteNom004 } from "./guardia-legal";
import type { IndicacionTerapeutica, NotaClinica } from "./nota-types";
import { textoCampoClinico } from "./texto-campo";

export const SOAP_SYSTEM_PROMPT = `Eres médico redactor clínico de MediEscribe (NOM-004-SSA3). Lees un dictado conversacional y lo conviertes en una nota SOAP profesional.

REGLAS:
1. Actúa como médico, no como transcriptor. Analiza el diálogo y redacta.
2. Devuelve SOLO un objeto JSON plano. Cada valor es un string. Nunca un objeto, nunca un array (salvo que se pida).
3. Llaves EXACTAS: motivo_consulta, padecimiento_actual, subjetivo, objetivo, analisis, plan.
4. motivo_consulta: UNA frase clínica corta (2–8 palabras). Ejemplos correctos: "Odinofagia y fiebre", "Otalgia y odinofagia". Prohibido copiar el diálogo.
5. padecimiento_actual: narrativa médica en tercera persona, profesional, basada solo en lo que dijo el paciente. Incluye síntomas, tiempo, intensidad y datos referidos (p. ej. temperatura). Nunca saludos ni muletillas.
6. subjetivo: puede coincidir con padecimiento_actual o resumirlo. String. Si no hay clínica, "".
7. objetivo: solo exploración, signos vitales u hallazgos EXPLÍCITOS en el dictado. Si el paciente refirió fiebre de 38 °C y no hay exploración física, deja objetivo "" (la fiebre referida va en padecimiento_actual). No inventes.
8. analisis: impresión diagnóstica SOLO si se desprende de los síntomas dictados. Si no hay suficiente, "".
9. plan: indicaciones SOLO si se dictaron. No inventes tratamiento. Si no hay plan dictado, "".
10. Si el texto es solo saludo, charla, prueba de micrófono o ruido, TODOS los campos van "".
11. Prohibido copiar "hola", "buenos días", "dígame", "prueba de micrófono" o el diálogo crudo a cualquier campo.

Ejemplo de salida con clínica:
{"motivo_consulta":"Odinofagia y fiebre","padecimiento_actual":"Paciente refiere irritación faríngea con odinofagia a la deglución, fiebre nocturna de aproximadamente 38 °C y sensación de oídos tapados.","subjetivo":"Irritación faríngea, odinofagia, fiebre ~38 °C y otalgia/ocupación ótica referida.","objetivo":"","analisis":"","plan":""}

Responde ÚNICAMENTE el JSON.`;

export type SoapClinico = {
  motivo_consulta: string;
  padecimiento_actual: string;
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan: string;
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
  /\b(dolor|duele|fiebre|calentura|tos|nause|nauseas|v[oó]mit|mareo|cefalea|diarrea|alerg|asma|hipertens|diabetes|presi[oó]n|glucosa|temperatura|exploraci[oó]n|abdomen|pulm[oó]n|coraz[oó]n|diagn[oó]stic|tratamiento|medicament|recet|s[ií]ntoma|padecimiento|consulta por|acude por|viene por|antecedente|cirug[ií]a|herida|infecci[oó]n|sangrado|disnea|taquicard|edema|lesi[oó]n|fractura|embarazo|gesta|motivo|garganta|odinofagia|faring|otalgia|o[ií]do|arde|irritad|tapado)\b/i;

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
  const fromNota =
    raw.nota_medica_espanol && typeof raw.nota_medica_espanol === "object" && !Array.isArray(raw.nota_medica_espanol)
      ? (raw.nota_medica_espanol as Record<string, unknown>)
      : raw.nota && typeof raw.nota === "object" && !Array.isArray(raw.nota)
        ? (raw.nota as Record<string, unknown>)
        : null;
  const nested =
    raw.soap && typeof raw.soap === "object" && !Array.isArray(raw.soap)
      ? (raw.soap as Record<string, unknown>)
      : fromNota?.soap && typeof fromNota.soap === "object" && !Array.isArray(fromNota.soap)
        ? (fromNota.soap as Record<string, unknown>)
        : fromNota ?? raw;
  const campo = (...keys: string[]) => {
    for (const key of keys) {
      const value = asText(nested[key]) || asText(raw[key]) || (fromNota ? asText(fromNota[key]) : "");
      if (value && !esRuidoNoClinico(value)) return value;
    }
    return "";
  };
  const motivo = campo("motivo_consulta");
  const padecimiento = campo("padecimiento_actual");
  const subjetivo = campo("subjetivo") || padecimiento;
  const objetivo = campo("objetivo");
  const analisis = campo("analisis", "análisis");
  const plan = campo("plan", "plan_tratamiento");
  const cie = asText(raw.diagnostico_cie10) || asText(nested.diagnostico_cie10);
  const soap: SoapClinico = {
    motivo_consulta: motivo,
    padecimiento_actual: padecimiento,
    subjetivo,
    objetivo,
    analisis,
    plan,
    plan_tratamiento: plan,
    medicamentos: parseMedicamentos(raw.medicamentos ?? nested.medicamentos),
    diagnostico_cie10: (cie.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?/i)?.[0] ?? cie).toUpperCase(),
    pronostico: campo("pronostico", "pronóstico"),
  };
  if (!soap.motivo_consulta && !soap.padecimiento_actual && !soap.subjetivo && !soap.objetivo && !soap.analisis && !soap.plan) {
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
  if (estaVacio(soap.plan) && estaVacio(soap.plan_tratamiento)) {
    push("plan", "Falta el plan de tratamiento. Complételo antes de guardar.", "6.1.6 / 6.2.6");
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
  const motivo = asText(soap.motivo_consulta);
  const padecimiento = asText(soap.padecimiento_actual);
  const subjetivo = asText(soap.subjetivo) || padecimiento;
  const objetivo = asText(soap.objetivo);
  const analisis = asText(soap.analisis);
  const plan = asText(soap.plan) || asText(soap.plan_tratamiento);
  const medsTexto = soap.medicamentos
    .map((row) => [row.medicamento, row.dosis, row.via, row.periodicidad].filter(Boolean).join(" "))
    .join("\n");
  return {
    ...nota,
    motivo_consulta: motivo,
    padecimiento_actual: padecimiento,
    subjetivo,
    objetivo,
    analisis,
    exploracion_fisica: objetivo,
    diagnostico: analisis,
    diagnostico_cie10: analisis ? asText(soap.diagnostico_cie10) : "",
    plan,
    pronostico: asText(soap.pronostico),
    tratamiento: soap.medicamentos.length ? soap.medicamentos : [],
    medicamentos: medsTexto,
    resumen: [motivo, analisis, plan].filter(Boolean).join(". "),
  };
}

async function extraerCampoSecuencial(
  env: Env,
  transcripcion: string,
  campo: "motivo_consulta" | "padecimiento_actual",
  system: string
): Promise<string> {
  console.log(`SOAP paso ${campo}: enviando a Groq`);
  try {
    const raw = await groqChatJson(
      env,
      [
        { role: "system", content: system },
        { role: "user", content: `DICTADO:\n${transcripcion}` },
      ],
      { temperature: 0.1, maxTokens: 500, timeoutMs: 16_000, stream: false }
    );
    const valor =
      asText(raw[campo]) ||
      asText((raw.nota as Record<string, unknown> | undefined)?.[campo]) ||
      asText(raw.texto) ||
      asText(raw.content);
    const limpio = valor && !esRuidoNoClinico(valor) ? valor : "";
    console.log(`SOAP paso ${campo} listo:`, limpio || "(vacío)");
    return limpio;
  } catch (error) {
    console.error(
      `SOAP paso ${campo} falló:`,
      error instanceof Error ? error.message : "error"
    );
    return "";
  }
}

export async function sintetizarSoapClinico(env: Env, transcripcion: string): Promise<SoapClinico> {
  const clipped = clipTranscript(transcripcion);
  if (!clipped) {
    throw new AppError(400, "La transcripción no puede estar vacía.", "TRANSCRIPT_EMPTY");
  }
  const vacio = parseSoapClinico({});
  if (esRuidoNoClinico(clipped)) {
    console.log("SOAP secuencial: dictado es ruido, campos vacíos");
    return vacio;
  }
  console.log("SOAP secuencial: inicio, chars=", clipped.length);
  const motivo_consulta = await extraerCampoSecuencial(
    env,
    clipped,
    "motivo_consulta",
    `Eres médico redactor. Extrae SOLO el motivo de consulta.
Devuelve JSON plano: {"motivo_consulta":"..."}.
El valor es UNA frase clínica corta (2 a 8 palabras), p. ej. "Odinofagia y fiebre".
No copies el diálogo. Sin saludos. Si no hay clínica, {"motivo_consulta":""}.`
  );
  const padecimiento_actual = await extraerCampoSecuencial(
    env,
    clipped,
    "padecimiento_actual",
    `Eres médico redactor. Extrae SOLO el padecimiento actual.
Devuelve JSON plano: {"padecimiento_actual":"..."}.
Redacta en tercera persona, estilo clínico, basado en lo que dijo el paciente.
Incluye síntomas, tiempo e intensidad referidos. Sin saludos ni transcripción literal.
Si no hay clínica, {"padecimiento_actual":""}.`
  );
  const soap: SoapClinico = {
    ...vacio,
    motivo_consulta,
    padecimiento_actual,
    subjetivo: padecimiento_actual,
    objetivo: "",
    analisis: "",
    plan: "",
    plan_tratamiento: "",
  };
  console.log("SOAP secuencial terminado:", JSON.stringify({
    motivo_consulta: soap.motivo_consulta,
    padecimiento_actual: soap.padecimiento_actual,
  }));
  return soap;
}
