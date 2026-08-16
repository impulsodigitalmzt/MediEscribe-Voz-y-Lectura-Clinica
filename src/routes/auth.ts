import { Hono } from "hono";
import { publicUser, type UserRow } from "../lib/models";
import {
  findUserByEmail,
  findUserById,
  insertUser,
  updateUser,
  withNeon,
  writeAudit,
} from "../lib/neon-store";
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

const DEMO_EMAIL = "doctor@hospital.com";
const DEMO_PASSWORD = "SecurePass123!";

async function ensureDemoPhysician(env: Env, email: string, password: string): Promise<void> {
  if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) return;

  await withNeon(env, async (sql) => {
    const existing = await findUserByEmail(sql, DEMO_EMAIL);
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    if (!existing) {
      await insertUser(sql, {
        email: DEMO_EMAIL,
        password_hash: passwordHash,
        full_name: "Dr. MediEscribe Pruebas",
        credentials: "MD",
        specialty: "Medicina General",
        institution: "Hospital de Pruebas",
        role: "physician",
        preferred_language: "es",
        is_active: true,
      });
      return;
    }
    await updateUser(sql, existing.id, {
      password_hash: passwordHash,
      is_active: true,
      failed_login_attempts: 0,
      locked_until: null,
    });
  });
}

authRoutes.get("/ready", (c) => {
  return c.json({
    neon: Boolean(c.env.DATABASE_URL),
    secret_key: Boolean(c.env.SECRET_KEY),
  });
});

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
  const password = body.password;
  const fullName = body.full_name.trim();
  const strength = validatePasswordStrength(password);
  if (strength) return jsonError(c, 400, strength);

  const email = body.email.toLowerCase().trim();
  try {
    const user = await withNeon(c.env, async (sql) => {
      const existing = await findUserByEmail(sql, email);
      if (existing) return null;
      const created = await insertUser(sql, {
        email,
        password_hash: await hashPassword(password),
        full_name: fullName,
        credentials: (body.credentials ?? "").trim(),
        specialty: (body.specialty ?? "General Practice").trim(),
        institution: (body.institution ?? "").trim(),
        role: "physician",
      });
      await writeAudit(sql, {
        user_id: created.id,
        action: "user.register",
        resource_type: "user",
        resource_id: created.id,
        details: { role: created.role },
        ip_address: clientIp(c),
        user_agent: userAgent(c),
      });
      return created;
    });
    if (!user) return jsonError(c, 409, "An account with this email already exists.");
    return c.json(await issueTokens(c.env, user), 201);
  } catch (error) {
    console.error(JSON.stringify({
      event: "register_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return jsonError(c, 500, "Registration failed.");
  }
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
    return jsonError(c, 500, `No se pudo crear la cuenta de prueba: ${message}`);
  }

  const ip = clientIp(c);
  if (!isDemoLogin && !(await rateLimitAuth(c.env, ip || email))) {
    return jsonError(c, 429, "Demasiados intentos. Espere unos minutos e inténtelo de nuevo.");
  }

  try {
    const tokens = await withNeon(c.env, async (sql) => {
      const user = await findUserByEmail(sql, email);
      if (!user) {
        await writeAudit(sql, {
          action: "user.login_failed",
          resource_type: "user",
          details: { error_type: "auth_failed" },
          ip_address: ip,
          user_agent: userAgent(c),
        });
        return { error: "invalid" as const };
      }

      if (!isDemoLogin && user.locked_until && new Date(user.locked_until) > new Date()) {
        return { error: "locked" as const };
      }

      if (!isDemoLogin && !(await verifyPassword(password, user.password_hash))) {
        const attempts = user.failed_login_attempts + 1;
        const max = parseIntEnv(c.env.RATE_LIMIT_AUTH_ATTEMPTS, 5);
        const windowMin = parseIntEnv(c.env.RATE_LIMIT_AUTH_WINDOW_MINUTES, 15);
        const patch: Record<string, unknown> = { failed_login_attempts: attempts };
        if (attempts >= max) {
          patch.locked_until = new Date(Date.now() + windowMin * 60_000).toISOString();
        }
        await updateUser(sql, user.id, patch);
        await writeAudit(sql, {
          action: "user.login_failed",
          resource_type: "user",
          details: { error_type: "auth_failed" },
          ip_address: ip,
          user_agent: userAgent(c),
        });
        return { error: "invalid" as const };
      }

      if (!user.is_active) return { error: "inactive" as const };

      await updateUser(sql, user.id, { failed_login_attempts: 0, locked_until: null });
      await writeAudit(sql, {
        user_id: user.id,
        action: "user.login",
        resource_type: "user",
        resource_id: user.id,
        details: { role: user.role },
        ip_address: ip,
        user_agent: userAgent(c),
      });
      return { user };
    });

    if ("error" in tokens) {
      if (tokens.error === "locked") {
        return jsonError(c, 401, "Cuenta bloqueada temporalmente por varios intentos fallidos. Inténtelo más tarde.");
      }
      if (tokens.error === "inactive") return jsonError(c, 401, "Esta cuenta está desactivada.");
      return jsonError(c, 401, "Correo o contraseña incorrectos.");
    }

    return c.json(await issueTokens(c.env, tokens.user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(JSON.stringify({ event: "login_failed", error: message }));
    return jsonError(c, 500, `No se pudo iniciar sesión: ${message}`);
  }
});

authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => null);
  if (!body?.refresh_token) return jsonError(c, 400, "refresh_token is required.");

  try {
    const payload = await validateToken(c.env, body.refresh_token, "refresh");
    const user = await withNeon(c.env, (sql) => findUserById(sql, payload.sub));
    if (!user || !user.is_active) return jsonError(c, 401, "User not found or deactivated.");
    return c.json(await issueTokens(c.env, user));
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
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = body[key];
    if (typeof value === "string") patch[key] = value.trim();
  }

  const user = await withNeon(c.env, async (sql) => {
    const updated = await updateUser(sql, c.get("auth").user_id, patch);
    if (updated) {
      await writeAudit(sql, {
        user_id: c.get("auth").user_id,
        action: "user.settings_updated",
        resource_type: "user",
        resource_id: c.get("auth").user_id,
        ip_address: clientIp(c),
        user_agent: userAgent(c),
      });
    }
    return updated;
  });
  if (!user) return jsonError(c, 500, "Profile update failed.");
  return c.json(publicUser(user));
});
