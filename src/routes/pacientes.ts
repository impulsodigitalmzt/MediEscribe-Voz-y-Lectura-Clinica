import { Hono } from "hono";
import type { Context } from "hono";
import { auditExpedienteMiddleware } from "../lib/audit";
import { requireAuth, type AuthContext } from "../lib/auth";
import { isAppError } from "../lib/errors";
import { jsonError } from "../lib/http";
import {
  buscarPacientes,
  crearPaciente,
  exigirPaciente,
  isUuid,
  listHistorialPaciente,
  type PacienteAlta,
} from "../lib/pacientes";
import { withSql } from "../lib/consultas";

export const pacienteRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

pacienteRoutes.use("*", requireAuth);
pacienteRoutes.use("*", auditExpedienteMiddleware());

pacienteRoutes.get("/buscar", async (c) => {
  try {
    const result = await withSql(c.env, c.executionCtx, (sql) =>
      buscarPacientes(sql, {
        q: c.req.query("q") ?? "",
        nombre: c.req.query("nombre") ?? "",
        apellido_paterno: c.req.query("apellido_paterno") ?? "",
        apellido_materno: c.req.query("apellido_materno") ?? "",
        fecha_nacimiento: c.req.query("fecha_nacimiento") ?? "",
        curp: c.req.query("curp") ?? "",
      })
    );
    return c.json({ ok: true, ...result });
  } catch (error) {
    return pacienteError(c, error, "paciente_buscar_failed");
  }
});

pacienteRoutes.post("/", async (c) => {
  try {
    const body = (await c.req.json<PacienteAlta>().catch(() => ({}))) as PacienteAlta;
    const paciente = await withSql(c.env, c.executionCtx, (sql) => crearPaciente(sql, body));
    return c.json({ ok: true, paciente, alta_requerida: false }, 201);
  } catch (error) {
    return pacienteError(c, error, "paciente_crear_failed");
  }
});

pacienteRoutes.get("/:id/historial", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de paciente inválido.");
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const paciente = await exigirPaciente(sql, id);
      const historial = await listHistorialPaciente(sql, id);
      return { paciente, historial };
    });
    return c.json({ ok: true, ...payload });
  } catch (error) {
    return pacienteError(c, error, "paciente_historial_failed");
  }
});

pacienteRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return jsonError(c, 400, "Identificador de paciente inválido.");
    const payload = await withSql(c.env, c.executionCtx, async (sql) => {
      const paciente = await exigirPaciente(sql, id);
      const historial = await listHistorialPaciente(sql, id);
      return { paciente, historial };
    });
    return c.json({ ok: true, ...payload });
  } catch (error) {
    return pacienteError(c, error, "paciente_get_failed");
  }
});

function pacienteError(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, error: unknown, event: string) {
  if (isAppError(error)) {
    return c.json({ ok: false, detail: error.message, code: error.code }, error.status);
  }
  console.error(
    JSON.stringify({
      event,
      path: c.req.path,
      message: error instanceof Error ? error.message : "unknown",
    })
  );
  return c.json({ ok: false, detail: "No se pudo procesar el expediente del paciente." }, 500);
}
