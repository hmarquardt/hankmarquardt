import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../../src/worker/index";
import type { Env } from "../../src/worker/env";

export const origin = "https://deepcuts.example";
const databases: DatabaseSync[] = [];
export function closeDatabases() {
  for (const db of databases.splice(0)) db.close();
}

function wrap(sql: DatabaseSync, query: string, params: unknown[] = []) {
  return {
    bind: (...values: unknown[]) => wrap(sql, query, values),
    first: async () => sql.prepare(query).get(...(params as never[])) ?? null,
    all: async () => ({
      results: sql.prepare(query).all(...(params as never[])),
    }),
    run: async () => ({
      meta: {
        changes: Number(sql.prepare(query).run(...(params as never[])).changes),
      },
    }),
  };
}

/** Reads the buffered or streamed value a Worker would hand to R2. */
async function readValue(value: unknown): Promise<Uint8Array> {
  if (value instanceof ReadableStream)
    return new Uint8Array(await new Response(value).arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Unsupported R2 value.");
}

export function environment() {
  const sql = new DatabaseSync(":memory:");
  databases.push(sql);
  for (const file of ["0001_foundation.sql", "0002_playlists.sql"])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  const objects = new Map<
    string,
    { bytes: Uint8Array; options: R2PutOptions; streamed: boolean }
  >();
  const env = {
    APP_ORIGIN: origin,
    OWNER_KEY: "a".repeat(64),
    DEPLOY_REVISION: "unit",
    DB: {
      prepare: (query: string) => wrap(sql, query),
      batch: async (statements: ReturnType<typeof wrap>[]) => {
        sql.exec("BEGIN");
        try {
          const result = await Promise.all(statements.map((s) => s.run()));
          sql.exec("COMMIT");
          return result;
        } catch (error) {
          sql.exec("ROLLBACK");
          throw error;
        }
      },
    },
    LOGIN_LIMIT: { limit: async () => ({ success: true }) },
    MUSIC: {
      put: async (key: string, value: unknown, options: R2PutOptions = {}) => {
        if (objects.has(key) && options.onlyIf) return null;
        // A streamed put fails when the verifying stream errors, which is how a
        // bad digest or truncated body never becomes an object.
        const bytes = await readValue(value);
        objects.set(key, {
          bytes,
          options,
          streamed: value instanceof ReadableStream,
        });
        return { key, size: bytes.byteLength, etag: `"${key}"` };
      },
      get: async (
        key: string,
        options?: { range: { offset: number; length: number } },
      ) => {
        const row = objects.get(key);
        if (!row) return null;
        const bytes = options?.range
          ? row.bytes.slice(
              options.range.offset,
              options.range.offset + options.range.length,
            )
          : row.bytes;
        return { body: bytes, httpMetadata: row.options.httpMetadata };
      },
      head: async (key: string) => {
        const row = objects.get(key);
        return (
          row && {
            size: row.bytes.byteLength,
            customMetadata: row.options.customMetadata,
          }
        );
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
    },
    ASSETS: {
      fetch: async () =>
        new Response("shell", { headers: { "Content-Type": "text/html" } }),
    },
  } as unknown as Env;
  const request = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${origin}${path}`, init), env);
  return { env, sql, request, objects };
}

export type Context = ReturnType<typeof environment>;

export async function authenticate(ctx: Context) {
  const response = await ctx.request("/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ key: ctx.env.OWNER_KEY }),
  });
  if (response.status !== 200)
    throw new Error(`Login failed with ${response.status}.`);
  return response.headers.get("Set-Cookie")!.split(";")[0];
}
