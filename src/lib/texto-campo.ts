const PROPIEDADES_TEXTO = [
  "text",
  "texto",
  "descripcion",
  "descripción",
  "contenido",
  "content",
  "value",
  "valor",
  "narrative",
  "narrativa",
  "resumen",
  "motivo_consulta",
  "motivo",
  "padecimiento_actual",
  "padecimiento",
  "subjetivo",
  "chief_complaint",
  "hpi",
  "objetivo",
  "exploracion_fisica",
  "analisis",
  "análisis",
  "diagnostico",
  "plan",
  "plan_tratamiento",
] as const;

function esVacioPlaceholder(text: string): boolean {
  return !text || text === "[object Object]" || /^\[(?:NO MENCIONADO|NOT DISCUSSED)\]$/i.test(text);
}

/**
 * Convierte cualquier valor de Groq/JSON en un string plano para SOAP.
 * Si llega un objeto o array, extrae text / descripcion / contenido antes de descartarlo.
 */
export function textoCampoClinico(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    return esVacioPlaceholder(text) ? "" : text;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean" || typeof value === "function") return "";
  if (depth > 5) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => textoCampoClinico(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const key of PROPIEDADES_TEXTO) {
      if (!(key in row)) continue;
      const extracted = textoCampoClinico(row[key], depth + 1);
      if (extracted) return extracted;
    }
    const partes = Object.values(row)
      .map((item) => textoCampoClinico(item, depth + 1))
      .filter(Boolean);
    return partes.join(" ").trim();
  }
  return "";
}
