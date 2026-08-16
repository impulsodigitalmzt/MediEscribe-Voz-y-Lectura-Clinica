import { Hono } from "hono";
import { createSupabase, publicUser, writeAudit, type UserRow } from "../lib/supabase";
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  validatePasswordStrength,
  validateToken,
  verifyPassword,
} from "../lib/security";
import { clientIp, jsonError, parseIntEnv, userAgent } from "../lib/http";
import { requireAuth, type AuthContext } from "../lib/auth";

type AppEnv = { Bindings: Env; Variables: { auth: AuthContext } };

export const authRoutes = new Hono<AppEnv>();

async function issueTokens(env: Env, user: UserRow) {
  const access = await createAccessToken(env, user.id, user.role, {
    name: user.full_name,
    specialty: user.specialty,
  });
  const refresh = await createRefreshToken(env, user.id);
  const minutes = parseIntEnv(env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES, 15);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: minutes * 60,
  };
}

async function rateLimitAuth(env: Env, key: string): Promise<boolean> {
  if (!env.RATE_LIMIT) return true;
  const windowMin = parseIntEnv(env.RATE_LIMIT_AUTH_WINDOW_MINUTES, 15);
  const max = parseIntEnv(env.RATE_LIMIT_AUTH_ATTEMPTS, 5);
  const kvKey = `auth:${key}`;
  const current = Number.parseInt((await env.RATE_LIMIT.get(kvKey)) ?? "0", 10);
  if (current >= max) return false;
  await env.RATE_LIMIT.put(kvKey, String(current + 1), { expirationTtl: windowMin * 60 });
  return true;
}

/** Cuenta de pruebas (misma que el formulario de login). Se crea o repara al entrar. */
const DEMO_EMAIL = "doctor@hospital.com";
const DEMO_PASSWORD = "SecurePass123!";

async function ensureDemoPhysician(env: Env, email: string, password: string): Promise<void> {
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) return;

  const db = createSupabase(env);
  const { data: existing } = await db.from("users").select("id").eq("email", DEMO_EMAIL).maybeSingle();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  if (!existing) {
    const { error } = await db.from("users").insert({
      email: DEMO_EMAIL,
      password_hash: passwordHash,
      full_name: "Dr. MediEscribe Pruebas",
      credentials: "MD",
      specialty: "Medicina General",
      institution: "Hospital de Pruebas",
      role: "physician",
      preferred_language: "es",
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
    });
    if (error) {
      console.error(JSON.stringify({ event: "demo_user_create_failed", error: error.message }));
      throw new Error(error.message);
    }
    return;
  }

  const { error } = await db
    .from("users")
    .update({
      password_hash: passwordHash,
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq("id", existing.id);
  if (error) {
    console.error(JSON.stringify({ event: "demo_user_reset_failed", error: error.message }));
  }
}

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    full_name?: string;
    credentials?: string;
    specialty?: string;
    institution?: string;
  }>().catch(() => null);
  if (!body?.email || !body.password || !body.full_name) {
    return jsonError(c, 400, "email, password and full_name are required.");
  }
  const strength = validatePasswordStrength(body.password);
  if (strength) return jsonError(c, 400, strength);

  const db = createSupabase(c.env);
  const email = body.email.toLowerCase().trim();
  const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) return jsonError(c, 409, "An account with this email already exists.");

  const { data: user, error } = await db
    .from("users")
    .insert({
      email,
      password_hash: await hashPassword(body.password),
      full_name: body.full_name.trim(),
      credentials: (body.credentials ?? "").trim(),
      specialty: (body.specialty ?? "General Practice").trim(),
      institution: (body.institution ?? "").trim(),
      role: "physician",
    })
    .select("*")
    .single();

  if (error || !user) {
    console.error(JSON.stringify({ event: "register_failed", error: error?.message }));
    return jsonError(c, 500, "Registration failed.");
  }

  await writeAudit(db, {
    user_id: user.id,
    action: "user.register",
    resource_type: "user",
    resource_id: user.id,
    details: { role: user.role },
    ip_address: clientIp(c),
    user_agent: userAgent(c),
  });

  return c.json(await issueTokens(c.env, user as UserRow), 201);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null);
  if (!body?.email || !body.password) return jsonError(c, 400, "El correo y la contraseña son obligatorios.");

  const email = body.email.toLowerCase().trim();
  const password = body.password;
  const isDemoLogin = email === DEMO_EMAIL && password === DEMO_PASSWORD;

  try {
    await ensureDemoPhysician(c.env, email, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error(JSON.stringify({ event: "demo_login_ensure_failed", error: message }));
    return jsonError(
      c,
      500,
      "No se pudo crear la cuenta de prueba. Verifique Supabase (tabla users) y las claves del Worker."
    );
  }

  const ip = clientIp(c);
  if (!isDemoLogin && !(await rateLimitAuth(c.env, ip || email))) {
    return jsonError(c, 429, "Demasiados intentos. Espere unos minutos e inténtelo de nuevo.");
  }

  const db = createSupabase(c.env);
  const { data: user } = await db.from("users").select("*").eq("email", email).maybeSingle();

  if (!user) {
    await writeAudit(db, {
      action: "user.login_failed",
      resource_type: "user",
      details: { error_type: "auth_failed" },
      ip_address: ip,
      user_agent: userAgent(c),
    });
    return jsonError(c, 401, "Correo o contraseña incorrectos.");
  }

  const row = user as UserRow;
  if (!isDemoLogin && row.locked_until && new Date(row.locked_until) > new Date()) {
    return jsonError(c, 401, "Cuenta bloqueada temporalmente por varios intentos fallidos. Inténtelo más tarde.");
  }

  if (!isDemoLogin && !(await verifyPassword(password, row.password_hash))) {
    const attempts = row.failed_login_attempts + 1;
    const max = parseIntEnv(c.env.RATE_LIMIT_AUTH_ATTEMPTS, 5);
    const windowMin = parseIntEnv(c.env.RATE_LIMIT_AUTH_WINDOW_MINUTES, 15);
    const patch: Record<string, unknown> = { failed_login_attempts: attempts };
    if (attempts >= max) {
      patch.locked_until = new Date(Date.now() + windowMin * 60_000).toISOString();
    }
    await db.from("users").update(patch).eq("id", row.id);
    await writeAudit(db, {
      action: "user.login_failed",
      resource_type: "user",
      details: { error_type: "auth_failed" },
      ip_address: ip,
      user_agent: userAgent(c),
    });
    return jsonError(c, 401, "Correo o contraseña incorrectos.");
  }

  if (!row.is_active) return jsonError(c, 401, "Esta cuenta está desactivada.");

  await db.from("users").update({ failed_login_attempts: 0, locked_until: null }).eq("id", row.id);
  await writeAudit(db, {
    user_id: row.id,
    action: "user.login",
    resource_type: "user",
    resource_id: row.id,
    details: { role: row.role },
    ip_address: ip,
    user_agent: userAgent(c),
  });

  return c.json(await issueTokens(c.env, row));
});

authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => null);
  if (!body?.refresh_token) return jsonError(c, 400, "refresh_token is required.");

  try {
    const payload = await validateToken(c.env, body.refresh_token, "refresh");
    const db = createSupabase(c.env);
    const { data: user } = await db.from("users").select("*").eq("id", payload.sub).maybeSingle();
    if (!user || !user.is_active) return jsonError(c, 401, "User not found or deactivated.");
    return c.json(await issueTokens(c.env, user as UserRow));
  } catch {
    return jsonError(c, 401, "Invalid refresh token.");
  }
});

authRoutes.get("/profile", requireAuth, (c) => {
  return c.json(publicUser(c.get("auth").user));
});

authRoutes.patch("/profile", requireAuth, async (c) => {
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  const allowed = [
    "full_name", "credentials", "specialty", "institution",
    "preferred_language", "preferred_template", "whatsapp_phone",
  ] as const;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    const value = body[key];
    if (typeof value === "string") patch[key] = value.trim();
  }

  const db = createSupabase(c.env);
  const { data: user, error } = await db
    .from("users")
    .update(patch)
    .eq("id", c.get("auth").user_id)
    .select("*")
    .single();
  if (error || !user) return jsonError(c, 500, "Profile update failed.");

  await writeAudit(db, {
    user_id: c.get("auth").user_id,
    action: "user.settings_updated",
    resource_type: "user",
    resource_id: c.get("auth").user_id,
    ip_address: clientIp(c),
    user_agent: userAgent(c),
  });
  return c.json(publicUser(user as UserRow));
});
