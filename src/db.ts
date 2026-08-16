import { neon } from "@neondatabase/serverless";

/**
 * Cliente Neon HTTP para Cloudflare Workers.
 *
 * `neon()` de `@neondatabase/serverless` ejecuta SQL sobre fetch/HTTP.
 * No abre sockets TCP (frágiles o incompatibles en el runtime edge)
 * ni requiere Hyperdrive ni el driver `postgres` de Node.js.
 *
 * Cada llamada es una petición HTTP independiente: no hay pool que
 * cerrar. `end()` se conserva como no-op para no romper `withSql`.
 */
export type Sql = {
  <T = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  json(value: unknown): unknown;
  query(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe(query: string): Promise<Record<string, unknown>[]>;
  end(options?: { timeout?: number }): Promise<void>;
};

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export function createSql(databaseUrl: string): Sql {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  const httpSql = neon(databaseUrl);
  const nativeQuery = httpSql.query.bind(httpSql);
  const sql = httpSql as unknown as Sql;

  sql.json = (value: unknown) => value;
  sql.query = (query: string, params?: unknown[]) =>
    nativeQuery(query, params ?? []) as Promise<Record<string, unknown>[]>;
  sql.unsafe = (query: string) => nativeQuery(query) as Promise<Record<string, unknown>[]>;
  sql.end = async () => undefined;

  return sql;
}

export function closeSql(_sql: Sql, _ctx?: WaitUntilContext): void {
  // El driver HTTP no retiene conexiones TCP en el isolate.
}
