import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoutes } from "./routes/auth";
import { consultaRoutes } from "./routes/consultas";
import { encounterRoutes } from "./routes/encounters";
import { pacienteRoutes } from "./routes/pacientes";
import { templateRoutes } from "./routes/templates";
import { whatsappRoutes } from "./routes/whatsapp";
import { handleAudioWebSocket } from "./routes/ws";
import { isAppError } from "./lib/errors";
import { isNom004Error, NORMA_EXPEDIENTE } from "./lib/guardia-legal";
import { securityHeaders } from "./lib/http";

const api = new Hono<{ Bindings: Env }>();

api.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 86400,
  })
);

api.use("*", async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(securityHeaders())) {
    c.res.headers.set(key, value);
  }
});

api.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: c.env.APP_NAME || "MedScribe",
    version: c.env.APP_VERSION || "2.0.0",
    environment: c.env.ENVIRONMENT || "production",
  })
);

api.get("/", (c) =>
  c.json({
    service: "MedScribe API",
    version: c.env.APP_VERSION || "2.0.0",
    runtime: "cloudflare-workers",
  })
);

api.route("/api/v1/auth", authRoutes);
api.route("/api/v1/encounters", encounterRoutes);
api.route("/api/v1/templates", templateRoutes);
api.route("/api/pacientes", pacienteRoutes);
api.route("/api/consultas-medicas", consultaRoutes);
api.route("/webhook/whatsapp", whatsappRoutes);

api.notFound((c) => c.json({ detail: "The requested resource was not found." }, 404));

api.onError((err, c) => {
  if (isNom004Error(err)) {
    return c.json(
      {
        ok: false,
        code: err.code,
        detail: err.message,
        norma: NORMA_EXPEDIENTE,
        faltantes: err.faltantes,
        guia: err.guia,
        nota: err.nota ?? null,
      },
      err.status
    );
  }
  if (isAppError(err)) {
    return c.json({ ok: false, detail: err.message, code: err.code }, err.status);
  }
  console.error(JSON.stringify({ event: "unhandled_error", name: err.name, path: c.req.path }));
  return c.json({ detail: "An internal error occurred. Please try again." }, 500);
});

function isWorkerPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/webhook/") ||
    pathname === "/health" ||
    pathname === "/health/"
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/v1/ws/audio/")) {
      return handleAudioWebSocket(request, env);
    }
    const mutating = request.method !== "GET" && request.method !== "HEAD";
    if (isWorkerPath(url.pathname) || mutating) {
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
