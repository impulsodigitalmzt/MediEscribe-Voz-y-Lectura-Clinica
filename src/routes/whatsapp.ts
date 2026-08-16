import { Hono } from "hono";
import { createSupabase, writeAudit, type EncounterRow, type UserRow } from "../lib/supabase";
import { generateEncounterCode } from "../lib/security";
import { generateAndStoreNote, storeTranscript } from "../lib/notes";
import { formatNoteForWhatsApp, transcribeAudio } from "../lib/groq";
import {
  downloadMedia,
  helpMessage,
  parseIncoming,
  sendText,
  verifyWebhookSignature,
  type WhatsAppIncoming,
} from "../lib/whatsapp";

export const whatsappRoutes = new Hono<{ Bindings: Env }>();

whatsappRoutes.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token && token === c.env.VERIFY_TOKEN && challenge) {
    return c.text(challenge, 200);
  }
  return c.text("Forbidden", 403);
});

whatsappRoutes.post("/", async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256");
  if (!(await verifyWebhookSignature(c.env, raw, signature))) {
    return c.text("Invalid signature", 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ status: "ignored" });
  }

  const messages = parseIncoming(payload);
  if (messages.length > 0) {
    c.executionCtx.waitUntil(processMessages(c.env, messages));
  }
  return c.json({ status: "accepted" }, 200);
});

async function processMessages(env: Env, messages: WhatsAppIncoming[]): Promise<void> {
  for (const message of messages) {
    try {
      await handleOne(env, message);
    } catch (err) {
      console.error(JSON.stringify({ event: "whatsapp_message_failed", error: String(err) }));
      await sendText(env, message.from, "No pude procesar el mensaje. Inténtalo de nuevo en un momento.");
    }
  }
}

async function handleOne(env: Env, message: WhatsAppIncoming): Promise<void> {
  const db = createSupabase(env);
  const { data: already } = await db
    .from("whatsapp_events")
    .select("id")
    .eq("wa_message_id", message.messageId)
    .maybeSingle();
  if (already) return;

  await db.from("whatsapp_events").insert({
    wa_message_id: message.messageId,
    from_phone: message.from,
    message_type: message.type,
    status: "processing",
  });

  const text = (message.text ?? "").trim();
  if (/^(ayuda|help|hola|hi|start)$/i.test(text)) {
    await sendText(env, message.from, helpMessage());
    return;
  }

  let transcript = text.replace(/^nota\s+/i, "").trim();
  if ((message.type === "audio" || message.type === "voice") && message.mediaId) {
    await sendText(env, message.from, "Recibí el audio. Transcribiendo…");
    const media = await downloadMedia(env, message.mediaId);
    const whisper = await transcribeAudio(env, media.blob, media.filename);
    transcript = whisper.text;
  }

  if (!transcript) {
    await sendText(env, message.from, helpMessage());
    return;
  }

  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("whatsapp_phone", message.from)
    .eq("is_active", true)
    .maybeSingle();

  if (!user) {
    const draft = await generateStandaloneNote(env, transcript);
    await sendText(env, message.from, draft);
    await sendText(
      env,
      message.from,
      "Para guardar la nota en tu cuenta MedScribe, registra tu número de WhatsApp en Ajustes (solo dígitos, con código de país, sin +)."
    );
    return;
  }

  const physician = user as UserRow;
  const { data: encounter, error } = await db
    .from("encounters")
    .insert({
      encounter_id: generateEncounterCode(),
      physician_id: physician.id,
      specialty_template: physician.preferred_template || "general_practice",
      spoken_language: physician.preferred_language || "es",
      output_language: physician.preferred_language || "es",
      status: "transcribing",
      source: "whatsapp",
      consent_recorded: true,
    })
    .select("*")
    .single();

  if (error || !encounter) throw new Error(error?.message ?? "Encounter create failed");

  await storeTranscript(db, encounter.id, transcript, "whatsapp", physician.preferred_language || "es", 0.9);
  const note = await generateAndStoreNote(env, db, encounter as EncounterRow, transcript);
  await db
    .from("whatsapp_events")
    .update({ encounter_id: encounter.id, status: "completed" })
    .eq("wa_message_id", message.messageId);
  await writeAudit(db, {
    user_id: physician.id,
    action: "whatsapp.note_generated",
    resource_type: "encounter",
    resource_id: encounter.id,
    details: { source: "whatsapp" },
  });

  await sendText(
    env,
    message.from,
    `${formatNoteForWhatsApp(note as unknown as Record<string, unknown>)}\n\nID: ${encounter.encounter_id}`
  );
}

async function generateStandaloneNote(env: Env, transcript: string): Promise<string> {
  const { polishNote, polishedToNoteFields, formatNoteForWhatsApp } = await import("../lib/groq");
  const polished = await polishNote(env, transcript, "general_practice", "es", "regular");
  return formatNoteForWhatsApp(polishedToNoteFields(polished));
}
