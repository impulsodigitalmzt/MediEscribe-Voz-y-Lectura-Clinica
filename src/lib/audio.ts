import type { Context } from "hono";
import { AppError } from "./errors";

/** Groq Whisper accepts files up to 25 MB. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "wav",
  "webm",
]);

const ALLOWED_MIME = new Set([
  "audio/flac",
  "audio/x-flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/mpga",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/webm",
  "video/webm",
  "video/mp4",
  "application/octet-stream",
]);

const MIME_TO_EXT: Record<string, string> = {
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mpga",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/vnd.wave": "wav",
  "audio/webm": "webm",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export type AudioUpload = {
  blob: Blob;
  filename: string;
  mimeType: string;
  size: number;
};

export type ConsultaFormFields = {
  pacienteId: string;
  pacienteNombre: string;
  idioma: string;
  especialidad: string;
  medicoNombre: string;
  medicoCedula: string;
  sexo: string;
  domicilio: string;
  consultaId: string;
};

export type ConsultaMultipart = ConsultaFormFields & {
  audio: AudioUpload;
  raw: Record<string, string | File>;
};

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
  return cleaned || "consulta.webm";
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}

export function readFormText(
  body: Record<string, string | File>,
  keys: string[],
  fallback = ""
): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function asFile(value: string | File | undefined): File | null {
  if (!value || typeof value === "string") return null;
  return value;
}

function validateAudioFile(file: File): AudioUpload {
  if (file.size <= 0) {
    throw new AppError(400, "El archivo de audio está vacío.", "AUDIO_EMPTY");
  }
  if (file.size > MAX_AUDIO_BYTES) {
    throw new AppError(413, "El audio supera el límite de 25 MB de Whisper.", "AUDIO_TOO_LARGE");
  }

  const originalName = file.name || "consulta.webm";
  const filename = sanitizeFilename(originalName);
  const ext = extensionOf(filename);
  const mime = (file.type || "application/octet-stream").toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME.has(mime)) {
    throw new AppError(
      415,
      "Formato no soportado. Usa mp3, wav, m4a, ogg, webm o flac.",
      "AUDIO_UNSUPPORTED"
    );
  }

  const safeName = ALLOWED_EXTENSIONS.has(ext)
    ? filename
    : `${filename.replace(/\.[^.]+$/, "")}.${MIME_TO_EXT[mime] ?? "webm"}`;

  return {
    blob: file,
    filename: safeName,
    mimeType: mime,
    size: file.size,
  };
}

export async function parseMultipartBody(c: Context): Promise<Record<string, string | File>> {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new AppError(
      400,
      "Envía el audio como multipart/form-data (campo audio o file).",
      "INVALID_CONTENT_TYPE"
    );
  }

  try {
    return (await c.req.parseBody()) as Record<string, string | File>;
  } catch {
    throw new AppError(400, "No se pudo leer el formulario. Verifica el archivo de audio.", "INVALID_MULTIPART");
  }
}

export function extractAudioFromBody(body: Record<string, string | File>): AudioUpload {
  const file = asFile(body.audio) ?? asFile(body.file) ?? asFile(body.archivo) ?? asFile(body.recording);
  if (!file) {
    throw new AppError(400, "Falta el archivo de audio. Usa el campo 'audio' o 'file'.", "AUDIO_REQUIRED");
  }
  return validateAudioFile(file);
}

export function extractConsultaFields(body: Record<string, string | File>): ConsultaFormFields {
  const pacienteId = readFormText(body, ["paciente_id", "patient_id"]);
  const pacienteNombre = readFormText(body, ["paciente_nombre", "patient_name", "nombre"], "Paciente sin identificar");
  const idioma = readFormText(body, ["idioma", "language", "spoken_language"], "es").toLowerCase();
  const especialidad = readFormText(body, ["especialidad", "specialty", "specialty_template"], "medicina_general");
  const medicoNombre = readFormText(body, ["medico_nombre", "physician_name", "medico"]);
  const medicoCedula = readFormText(body, ["medico_cedula", "cedula", "cédula"]);
  const sexo = readFormText(body, ["sexo", "sex"]);
  const domicilio = readFormText(body, ["domicilio", "direccion", "dirección"]);
  const consultaId = readFormText(body, ["consulta_id", "consultaId"]);
  return { pacienteId, pacienteNombre, idioma, especialidad, medicoNombre, medicoCedula, sexo, domicilio, consultaId };
}

export async function parseConsultaMultipart(c: Context): Promise<ConsultaMultipart> {
  const raw = await parseMultipartBody(c);
  return {
    audio: extractAudioFromBody(raw),
    ...extractConsultaFields(raw),
    raw,
  };
}

export function clipTranscript(text: string, maxChars = 12_000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[Transcripción recortada por límite del Worker]`;
}
