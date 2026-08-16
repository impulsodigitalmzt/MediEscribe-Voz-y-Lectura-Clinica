import { hmacSha256Hex, timingSafeEqual } from "./security";

const GRAPH = "https://graph.facebook.com";

export type WhatsAppIncoming = {
  from: string;
  messageId: string;
  type: string;
  text?: string;
  mediaId?: string;
  mimeType?: string;
};

export function graphBase(env: Env): string {
  return `${GRAPH}/${env.WHATSAPP_GRAPH_VERSION || "v21.0"}`;
}

export async function verifyWebhookSignature(
  env: Env,
  rawBody: string,
  header: string | undefined
): Promise<boolean> {
  if (!env.WHATSAPP_APP_SECRET) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(env.WHATSAPP_APP_SECRET, rawBody);
  const provided = header.slice("sha256=".length);
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  return timingSafeEqual(a, b);
}

export function parseIncoming(payload: unknown): WhatsAppIncoming[] {
  const messages: WhatsAppIncoming[] = [];
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            id: string;
            type: string;
            text?: { body?: string };
            audio?: { id?: string; mime_type?: string };
            voice?: { id?: string; mime_type?: string };
            image?: { id?: string; mime_type?: string; caption?: string };
            document?: { id?: string; mime_type?: string; caption?: string };
          }>;
        };
      }>;
    }>;
  };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        const incoming: WhatsAppIncoming = {
          from: msg.from,
          messageId: msg.id,
          type: msg.type,
        };
        if (msg.type === "text") incoming.text = msg.text?.body;
        if (msg.type === "audio") {
          incoming.mediaId = msg.audio?.id;
          incoming.mimeType = msg.audio?.mime_type;
        }
        if (msg.type === "voice" || (msg.type === "audio" && !incoming.mediaId)) {
          incoming.mediaId = incoming.mediaId ?? msg.voice?.id;
          incoming.mimeType = incoming.mimeType ?? msg.voice?.mime_type;
        }
        if (msg.type === "image") {
          incoming.mediaId = msg.image?.id;
          incoming.mimeType = msg.image?.mime_type;
          incoming.text = msg.image?.caption;
        }
        if (msg.type === "document") {
          incoming.mediaId = msg.document?.id;
          incoming.mimeType = msg.document?.mime_type;
          incoming.text = msg.document?.caption;
        }
        messages.push(incoming);
      }
    }
  }
  return messages;
}

export async function downloadMedia(env: Env, mediaId: string): Promise<{ blob: Blob; filename: string }> {
  const metaRes = await fetch(`${graphBase(env)}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error("WhatsApp media metadata failed");
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("WhatsApp media URL missing");

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!fileRes.ok) throw new Error("WhatsApp media download failed");

  const blob = await fileRes.blob();
  const ext = (meta.mime_type ?? "audio/ogg").includes("ogg")
    ? "ogg"
    : (meta.mime_type ?? "").includes("mp4")
      ? "mp4"
      : "bin";
  return { blob, filename: `whatsapp-media.${ext}` };
}

export async function sendText(env: Env, to: string, body: string): Promise<void> {
  if (!env.WHATSAPP_TOKEN || !env.PHONE_NUMBER_ID) {
    console.error(JSON.stringify({ event: "whatsapp_send_skipped", reason: "missing_credentials" }));
    return;
  }

  const chunks = splitWhatsApp(body);
  for (const chunk of chunks) {
    const res = await fetch(`${graphBase(env)}/${env.PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: chunk },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(JSON.stringify({ event: "whatsapp_send_failed", status: res.status, body: err.slice(0, 300) }));
    }
  }
}

export function helpMessage(): string {
  return [
    "*MedScribe — asistente clínico por WhatsApp*",
    "",
    "Envía un *audio* de la consulta o un *texto* con la conversación.",
    "Responderé con un borrador de nota clínica para revisión.",
    "",
    "Comandos:",
    "• *ayuda* — esta guía",
    "• *nota* + texto — genera nota desde texto",
    "",
    "_No sustituye el criterio médico. No envíes datos que no deban viajar por WhatsApp._",
  ].join("\n");
}

function splitWhatsApp(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, max));
    remaining = remaining.slice(max);
  }
  return parts;
}
