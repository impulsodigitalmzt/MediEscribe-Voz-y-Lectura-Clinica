import { findEncounter, storeTranscript, updateEncounter, withNeon } from "../lib/neon-store";
import { validateToken } from "../lib/security";

export async function handleAudioWebSocket(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/\/api\/v1\/ws\/audio\/([^/]+)$/);
  if (!match) return new Response("Not found", { status: 404 });
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const token = url.searchParams.get("token") ?? "";
  let userId: string;
  try {
    const payload = await validateToken(env, token, "access");
    userId = payload.sub;
  } catch {
    return new Response("Invalid authentication token", { status: 401 });
  }

  const encounterId = decodeURIComponent(match[1]);
  const encounter = await withNeon(env, (sql) => findEncounter(sql, encounterId, userId));
  if (!encounter) return new Response("Encounter not found", { status: 404 });

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const started = Date.now();
  let segments = 0;

  server.addEventListener("message", (event) => {
    void (async () => {
      if (typeof event.data !== "string") return;
      let msg: { type?: string; text?: string; speaker?: string; language?: string; confidence?: number };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }

      if (msg.type === "config") {
        server.send(JSON.stringify({ type: "ready", mode: "web_speech" }));
        return;
      }

      if (msg.type === "transcript_text") {
        const text = (msg.text ?? "").trim();
        if (!text) return;
        try {
          await withNeon(env, (sql) =>
            storeTranscript(
              sql,
              encounter.id,
              text,
              msg.speaker ?? "physician",
              msg.language ?? encounter.spoken_language,
              Number(msg.confidence ?? 1)
            )
          );
          segments += 1;
          server.send(JSON.stringify({ type: "ack", sequence: segments, text }));
        } catch (err) {
          console.error(JSON.stringify({ event: "ws_segment_failed", error: String(err) }));
          server.send(JSON.stringify({
            type: "error",
            message: "Failed to save segment. Please check your connection.",
          }));
        }
        return;
      }

      if (msg.type === "stop") {
        server.close(1000, "stopped");
      }
    })();
  });

  server.addEventListener("close", () => {
    const elapsed = Math.max(0, Math.round((Date.now() - started) / 1000));
    void withNeon(env, (sql) =>
      updateEncounter(sql, encounter.id, {
        duration_seconds: Math.max(encounter.duration_seconds ?? 0, elapsed),
      })
    );
  });

  return new Response(null, { status: 101, webSocket: client });
}
