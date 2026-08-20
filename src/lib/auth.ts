import type { Context, Next } from "hono";
import { findUserById, withNeon } from "./neon-store";
import { validateToken } from "./security";
import { jsonError } from "./http";
import type { UserRow } from "./models";

export type AuthContext = {
  user_id: string;
  role: string;
  name: string;
  user: UserRow;
};

export type AppContext = Context<{ Bindings: Env; Variables: { auth: AuthContext } }>;

export async function requireAuth(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, next: Next) {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return jsonError(c, 401, "Invalid or expired authentication token.");

  try {
    const payload = await validateToken(c.env, token, "access");
    const user = await withNeon(c.env, (sql) => findUserById(sql, payload.sub));
    if (!user || !user.is_active) {
      return jsonError(c, 401, "User account not found or deactivated.");
    }
    c.set("auth", {
      user_id: payload.sub,
      role: payload.role ?? user.role,
      name: String(payload.name ?? user.full_name),
      user,
    });
    await next();
  } catch {
    return jsonError(c, 401, "Invalid or expired authentication token.");
  }
}

export function requireRoles(roles: string[]) {
  return async (c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth || !roles.includes(auth.role)) {
      return jsonError(c, 403, "Insufficient permissions for this action.");
    }
    await next();
  };
}

export function sesionDesdeAuth(c: AppContext): { userId: string; role: string } {
  const auth = c.get("auth");
  return { userId: auth.user_id, role: auth.role };
}

export function medicoDesdeAuth(c: AppContext): {
  medicoNombre: string;
  medicoCedula: string;
  medicoEspecialidad: string;
} {
  const auth = c.get("auth");
  return {
    medicoNombre: (auth?.user?.full_name ?? auth?.name ?? "").trim(),
    medicoCedula: (auth?.user?.credentials ?? "").trim(),
    medicoEspecialidad: (auth?.user?.specialty ?? "").trim(),
  };
}

/** La sesión gana sobre el cuerpo: el sello legal no puede falsificarse desde el cliente. */
export function datosMedicoDesdeSesion(
  c: AppContext,
  extra: {
    medicoNombre?: string;
    medicoCedula?: string;
    medicoEspecialidad?: string;
    sexo?: string;
    domicilio?: string;
  } = {}
): {
  medicoNombre: string;
  medicoCedula: string;
  medicoEspecialidad: string;
  sexo?: string;
  domicilio?: string;
} {
  const session = medicoDesdeAuth(c);
  return {
    medicoNombre: session.medicoNombre || (extra.medicoNombre ?? "").trim(),
    medicoCedula: session.medicoCedula || (extra.medicoCedula ?? "").trim(),
    medicoEspecialidad: session.medicoEspecialidad || (extra.medicoEspecialidad ?? "").trim(),
    sexo: extra.sexo,
    domicilio: extra.domicilio,
  };
}
