import { AppError, isAppError } from "./errors";
import { isNom004Error, NORMA_EXPEDIENTE } from "./guardia-legal";
import { securityHeaders } from "./http";

/** Subrequest Groq: I/O no cuenta como CPU, pero el isolate no debe colgarse. */
export const GROQ_CHAT_TIMEOUT_MS = 28_000;
export const GROQ_WHISPER_TIMEOUT_MS = 55_000;
export const GROQ_REPAIR_TIMEOUT_MS = 16_000;
export const NEON_FETCH_TIMEOUT_MS = 12_000;
export const MAX_GROQ_JSON_CHARS = 48_000;
export const MAX_TRANSCRIPT_CHARS = 12_000;

export function allowedBrowserOrigin(origin: string | undefined, requestUrl: string, env: Env): string | null {
  if (!origin) return null;
  try {
    const incoming = new URL(origin);
    const self = new URL(requestUrl);
    if (incoming.origin === self.origin) return origin;
    const host = incoming.hostname;
    if (host === "localhost" || host === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  const extra = String((env as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return extra.includes(origin) ? origin : null;
}

export function applyCorsHeaders(headers: Headers, origin: string | null): void {
  if (!origin) return;
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  headers.set("Access-Control-Max-Age", "86400");
}

export function applySecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(securityHeaders())) {
    headers.set(key, value);
  }
}

export function fetchTimeout(ms: number, extra?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!extra) return timeout;
  return AbortSignal.any([timeout, extra]);
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true;
  }
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

type SsePayload = Record<string, unknown>;

export function sseConsultaResponse(
  origin: string | null,
  work: (send: (payload: SsePayload) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: SsePayload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        await work(send);
      } catch (error) {
        if (isNom004Error(error)) {
          send({
            type: "error",
            ok: false,
            code: error.code,
            detail: error.message,
            norma: NORMA_EXPEDIENTE,
            faltantes: error.faltantes,
            guia: error.guia,
            nota: error.nota ?? null,
          });
        } else if (isAppError(error)) {
          send({ type: "error", ok: false, code: error.code, detail: error.message });
        } else if (isTimeoutError(error)) {
          send({
            type: "error",
            ok: false,
            code: "WORKER_TIMEOUT",
            detail: "La síntesis superó el tiempo del Worker. Dicte un fragmento más corto o reintente.",
          });
        } else {
          send({
            type: "error",
            ok: false,
            code: "CONSULTA_IA_FAILED",
            detail: "No se pudo procesar la consulta médica.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Accel-Buffering": "no",
  });
  applySecurityHeaders(headers);
  applyCorsHeaders(headers, origin);
  return new Response(stream, { status: 200, headers });
}

export function groqTimeoutError(kind: "chat" | "whisper" | "repair"): AppError {
  const detail =
    kind === "whisper"
      ? "Whisper no respondió a tiempo. Use un audio más corto."
      : "El modelo no terminó la nota dentro del límite del Worker. Reintente con un dictado más breve.";
  return new AppError(504, detail, "GROQ_TIMEOUT");
}
