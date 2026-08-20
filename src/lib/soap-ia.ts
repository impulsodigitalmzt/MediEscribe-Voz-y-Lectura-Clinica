import { clipTranscript } from "./audio";
import { groqChatJson } from "./groq";
import { AppError } from "./errors";
import { estaVacio, Nom004Error, type FaltanteNom004 } from "./guardia-legal";
import type { IndicacionTerapeutica, NotaClinica } from "./nota-types";

export const SOAP_SYSTEM_PROMPT = `Actúa como un experto en informática médica y cumplimiento legal (NOM-004-SSA3). Tu tarea es transformar la transcripción cruda en un objeto JSON con las llaves: subjetivo, objetivo, analisis, plan_tratamiento, medicamentos (array), diagnostico_cie10, pronostico. Mantén la confidencialidad estricta y no incluyas información fuera de este esquema.`;

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
  return typeof value === "string" ? value.trim() : "";
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
  return {
    subjetivo: asText(nested.subjetivo) || asText(raw.subjetivo),
    objetivo: asText(nested.objetivo) || asText(raw.objetivo),
    analisis: asText(nested.analisis) || asText(nested.análisis) || asText(raw.analisis),
    plan_tratamiento:
      asText(nested.plan_tratamiento) || asText(nested.plan) || asText(raw.plan_tratamiento) || asText(raw.plan),
    medicamentos: parseMedicamentos(raw.medicamentos ?? nested.medicamentos),
    diagnostico_cie10: (cie.match(/[A-TV-Z][0-9]{2}(?:\.[0-9]{1,4})?/i)?.[0] ?? cie).toUpperCase(),
    pronostico: asText(nested.pronostico) || asText(nested.pronóstico) || asText(raw.pronostico),
  };
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
  const motivo = soap.subjetivo.split(/[.!?]/)[0]?.trim().slice(0, 220) || soap.subjetivo;
  const diagnostico = soap.diagnostico_cie10
    ? soap.analisis.includes(soap.diagnostico_cie10)
      ? soap.analisis
      : `${soap.analisis} (CIE-10: ${soap.diagnostico_cie10})`
    : soap.analisis;
  const medsTexto = soap.medicamentos
    .map((row) => [row.medicamento, row.dosis, row.via, row.periodicidad].filter(Boolean).join(" "))
    .join("\n");
  return {
    ...nota,
    subjetivo: soap.subjetivo,
    objetivo: soap.objetivo,
    analisis: soap.analisis,
    motivo_consulta: motivo || nota.motivo_consulta,
    padecimiento_actual: soap.subjetivo || nota.padecimiento_actual,
    exploracion_fisica: soap.objetivo || nota.exploracion_fisica,
    diagnostico: diagnostico || nota.diagnostico,
    diagnostico_cie10: soap.diagnostico_cie10 || nota.diagnostico_cie10,
    plan: soap.plan_tratamiento || nota.plan,
    pronostico: soap.pronostico || nota.pronostico,
    tratamiento: soap.medicamentos.length ? soap.medicamentos : nota.tratamiento,
    medicamentos: medsTexto || nota.medicamentos,
    resumen: [motivo, diagnostico, soap.plan_tratamiento].filter(Boolean).join(". "),
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
diagnostico_cie10: código CIE-10 (p. ej. M54.5). No copies la transcripción.

TRANSCRIPCIÓN:
${clipped}`,
    },
  ]);
  return parseSoapClinico(raw);
}
