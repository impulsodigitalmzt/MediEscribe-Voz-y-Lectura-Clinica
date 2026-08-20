import { decryptText, encryptText } from "./security";

const PHI_PREFIX = "aesgcm$";

/** Cifra datos sensibles de salud en reposo (AES-GCM). Vacío se deja vacío. */
export async function cifrarPhi(secret: string, value: string | null | undefined): Promise<string> {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (text.startsWith(PHI_PREFIX)) return text;
  return encryptText(secret, text);
}

export async function descifrarPhi(secret: string, value: string | null | undefined): Promise<string | null> {
  if (value == null) return null;
  if (!value) return "";
  if (!value.startsWith(PHI_PREFIX)) return value;
  try {
    return await decryptText(secret, value);
  } catch {
    return value;
  }
}

/** Logs de Worker: nunca incluir transcripción, nota ni identificadores de paciente. */
export function logSinPhi(event: string, payload: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}
