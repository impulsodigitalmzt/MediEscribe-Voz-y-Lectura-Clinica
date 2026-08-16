import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError(c: Context, status: ContentfulStatusCode, detail: string) {
  return c.json({ detail }, status);
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "";
}

export function userAgent(c: Context): string {
  return (c.req.header("User-Agent") ?? "").slice(0, 255);
}

export function securityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
}

export function parseIntEnv(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}
