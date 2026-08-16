import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const PBKDF2_ITERATIONS = 100_000;
const ACCESS_TYPE = "access";
const REFRESH_TYPE = "refresh";

function encoder() {
  return new TextEncoder();
}

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function secretKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(bits)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const key = await crypto.subtle.importKey("raw", encoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    expected.byteLength * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createAccessToken(
  env: Env,
  userId: string,
  role: string,
  extra: Record<string, string> = {}
): Promise<string> {
  const minutes = Number.parseInt(env.JWT_ACCESS_TOKEN_EXPIRE_MINUTES || "15", 10);
  const key = await secretKey(env.SECRET_KEY);
  return new SignJWT({ role, type: ACCESS_TYPE, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .setJti(crypto.randomUUID())
    .sign(key);
}

export async function createRefreshToken(env: Env, userId: string): Promise<string> {
  const days = Number.parseInt(env.JWT_REFRESH_TOKEN_EXPIRE_DAYS || "7", 10);
  const key = await secretKey(env.SECRET_KEY);
  return new SignJWT({ type: REFRESH_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .setJti(crypto.randomUUID())
    .sign(key);
}

export async function validateToken(
  env: Env,
  token: string,
  expectedType: "access" | "refresh"
): Promise<JWTPayload & { sub: string; role?: string; type: string }> {
  const key = await secretKey(env.SECRET_KEY);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  if (payload.type !== expectedType) {
    throw new Error("Invalid token type");
  }
  if (!payload.sub) throw new Error("Token missing subject");
  return payload as JWTPayload & { sub: string; role?: string; type: string };
}

export async function encryptText(secret: string, plaintext: string): Promise<string> {
  if (!plaintext) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder().encode(plaintext));
  return `aesgcm$${toB64(iv)}$${toB64(cipher)}`;
}

export async function decryptText(secret: string, ciphertext: string): Promise<string> {
  if (!ciphertext) return "";
  if (!ciphertext.startsWith("aesgcm$")) return ciphertext;
  const [, ivB64, dataB64] = ciphertext.split("$");
  const key = await deriveAesKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(dataB64)
  );
  return new TextDecoder().decode(plain);
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function generateEncounterCode(): string {
  return `ENC-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one digit";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password must contain at least one special character";
  return null;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
