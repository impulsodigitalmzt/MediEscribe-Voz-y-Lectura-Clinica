import type { Context, Next } from "hono";
import { closeSql, createSql } from "../db.js";
import type { AuthContext } from "./auth";
import { ensureExpedienteSchema } from "./expediente-schema";
import { clientIp, userAgent } from "./http";
import { isUuid } from "./pacientes";

export type AuditAccion =
  | "acceso_expediente"
  | "busqueda"
  | "creacion_paciente"
  | "apertura_borrador"
  | "guardado_consulta"
  | "cierre_consulta"
  | "nota_aclaracion"
  | "cierre_aclaracion"
  | "modificacion"
  | "eliminacion";

function uuidEnRuta(path: string): string | null {
  const match = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] && isUuid(match[0]) ? match[0] : null;
}

function accionDesdeRequest(method: string, path: string): AuditAccion {
  const lower = path.toLowerCase();
  if (lower.includes("/aclaraciones") && lower.includes("/cerrar")) return "cierre_aclaracion";
  if (lower.includes("/aclaraciones") && method !== "GET") return "nota_aclaracion";
  if (lower.includes("/finalizar")) return "cierre_consulta";
  if (lower.includes("/abrir")) return "apertura_borrador";
  if (lower.includes("/buscar")) return "busqueda";
  if (method === "POST" && /\/api\/pacientes\/?$/.test(lower)) return "creacion_paciente";
  if (method === "PATCH" && lower.includes("/consultas")) return "guardado_consulta";
  if (method === "GET") return "acceso_expediente";
  if (method === "DELETE") return "eliminacion";
  return "modificacion";
}

function recursoDesdePath(path: string): string {
  if (path.includes("/aclaraciones")) return "nota_aclaracion";
  if (path.includes("/pacientes")) return "paciente";
  if (path.includes("/consultas")) return "consulta";
  return "expediente";
}

async function entidadDesdeRespuesta(c: Context, path: string): Promise<string | null> {
  const fromPath = uuidEnRuta(path);
  if (fromPath) return fromPath;
  try {
    const clone = c.res.clone();
    const body = (await clone.json()) as Record<string, unknown>;
    const nested = (value: unknown): string | null => {
      if (!value || typeof value !== "object") return null;
      const id = (value as { id?: unknown }).id;
      return typeof id === "string" && isUuid(id) ? id : null;
    };
    return (
      nested(body.aclaracion) ||
      nested(body.consulta) ||
      nested(body.paciente) ||
      (typeof body.id === "string" && isUuid(body.id) ? body.id : null)
    );
  } catch {
    return null;
  }
}

export async function registrarAuditLog(
  env: Env,
  entry: {
    userId: string | null;
    actorNombre: string | null;
    actorRol: string | null;
    accion: string;
    recurso: string;
    entidadAfectadaId: string | null;
    metodo: string;
    ruta: string;
    status: number;
    ip: string;
    userAgent: string;
  }
): Promise<void> {
  if (!env.DATABASE_URL) return;
  const sql = createSql(env.DATABASE_URL);
  try {
    await ensureExpedienteSchema(sql);
    await sql`
      INSERT INTO audit_logs (
        user_id, actor_id, actor_nombre, actor_rol, accion, recurso,
        entidad_afectada_id, recurso_id, metodo, ruta, status_code, ip, user_agent, "timestamp"
      ) VALUES (
        ${entry.userId},
        ${entry.userId},
        ${entry.actorNombre},
        ${entry.actorRol},
        ${entry.accion},
        ${entry.recurso},
        ${entry.entidadAfectadaId},
        ${entry.entidadAfectadaId},
        ${entry.metodo},
        ${entry.ruta},
        ${entry.status},
        ${entry.ip},
        ${entry.userAgent},
        NOW()
      )
    `;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "audit_log_failed",
        message: error instanceof Error ? error.message : "unknown",
      })
    );
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      closeSql(sql);
    }
  }
}

export function auditExpedienteMiddleware() {
  return async (c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, next: Next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }
    await next();
    const auth = c.get("auth");
    const path = new URL(c.req.url).pathname;
    const entidadAfectadaId = await entidadDesdeRespuesta(c, path);
    const job = registrarAuditLog(c.env, {
      userId: auth?.user_id ?? null,
      actorNombre: auth?.name ?? auth?.user?.full_name ?? null,
      actorRol: auth?.role ?? null,
      accion: accionDesdeRequest(c.req.method, path),
      recurso: recursoDesdePath(path),
      entidadAfectadaId,
      metodo: c.req.method,
      ruta: path,
      status: c.res.status,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    if (c.executionCtx) {
      c.executionCtx.waitUntil(job);
    } else {
      await job;
    }
  };
}
