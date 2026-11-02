import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../../src/worker/index";
import { byteRange } from "../../src/shared/range";
import { formatBytes, formatTime, sha256 } from "../../src/shared/model";
import {
  audioSignature,
  artworkMime,
  boundedBody,
  importSchema,
} from "../../src/worker/validation";
import {
  assertOrigin,
  cookieName,
  digest,
  sessionCookie,
} from "../../src/worker/auth";
import type { Env } from "../../src/worker/env";

const origin = "https://deepcuts.example";
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function environment() {
  const sql = new DatabaseSync(":memory:");
  databases.push(sql);
  sql.exec(
    readFileSync(
      new URL("../../migrations/0001_foundation.sql", import.meta.url),
      "utf8",
    ),
  );
  const wrap = (query: string, params: unknown[] = []) => ({
    bind: (...values: unknown[]) => wrap(query, values),
    first: async () => sql.prepare(query).get(...(params as never[])) ?? null,
    all: async () => ({
      results: sql.prepare(query).all(...(params as never[])),
    }),
    run: async () => ({
      meta: {
        changes: Number(sql.prepare(query).run(...(params as never[])).changes),
      },
    }),
  });
  const objects = new Map<
    string,
    { bytes: ArrayBuffer; options: R2PutOptions }
  >();
  const env = {
    APP_ORIGIN: origin,
    OWNER_KEY: "a".repeat(64),
    DEPLOY_REVISION: "unit",
    DB: {
      prepare: wrap,
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
      put: async (key: string, bytes: ArrayBuffer, options: R2PutOptions) => {
        if (objects.has(key) && options.onlyIf) return null;
        objects.set(key, { bytes, options });
        return {};
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
async function authenticate(ctx: ReturnType<typeof environment>) {
  const response = await ctx.request("/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ key: ctx.env.OWNER_KEY }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";")[0];
}

describe("byte ranges", () => {
  it.each([
    [null, 100, null],
    ["bytes=0-0", 100, { offset: 0, length: 1 }],
    ["bytes=90-", 100, { offset: 90, length: 10 }],
    ["bytes=-5", 100, { offset: 95, length: 5 }],
    ["bytes=-500", 100, { offset: 0, length: 100 }],
    ["bytes=50-999", 100, { offset: 50, length: 50 }],
  ])("normalizes %s", (header, size, expected) =>
    expect(byteRange(header, size)).toEqual(expected),
  );
  it.each([
    "bytes=100-",
    "bytes=20-10",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,4-5",
    "items=0-1",
    "bytes=9007199254740992-",
  ])("rejects %s", (header) =>
    expect(() => byteRange(header, 100)).toThrow(RangeError),
  );
});
describe("validation", () => {
  it("bounds bodies even without Content-Length", async () => {
    await expect(
      boundedBody(new Request(origin, { method: "POST", body: "too big" }), 3),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("recognizes supported signatures and rejects active artwork", () => {
    expect(
      audioSignature(
        new TextEncoder().encode("fLaC123456789").buffer,
        "audio/flac",
      ),
    ).toBe(true);
    expect(
      audioSignature(
        new TextEncoder().encode("<html>oops</html>").buffer,
        "audio/mpeg",
      ),
    ).toBe(false);
    expect(
      artworkMime(new TextEncoder().encode("<svg></svg>").buffer),
    ).toBeNull();
    expect(
      artworkMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
    ).toBe("image/png");
  });
  it("rejects empty or unknown manifest fields", () => {
    expect(
      importSchema.safeParse({
        title: "Album",
        artist: "Artist",
        year: null,
        tracks: [],
      }).success,
    ).toBe(false);
    expect(importSchema.safeParse({ sql: "DROP TABLE tracks" }).success).toBe(
      false,
    );
  });
  it("formats durations and storage without NaN", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(92)).toBe("1:32");
    expect(formatBytes(2 ** 30)).toBe("1.0 GB");
  });
});
describe("private Worker", () => {
  it("authenticates every library and media path, including HEAD and unknown APIs", async () => {
    const ctx = environment();
    for (const path of [
      "/api/library",
      "/api/imports",
      "/api/state",
      "/api/tracks/id/audio",
      "/api/albums/id/artwork",
      "/api/unknown",
    ]) {
      const response = await ctx.request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "object-src 'none'",
      );
    }
    expect(
      (await ctx.request("/api/tracks/id/audio", { method: "HEAD" })).status,
    ).toBe(401);
    expect((await ctx.request("/")).status).toBe(200);
  });
  it("uses a host-only secure session cookie and hashed tokens; rotation and expiry revoke access", async () => {
    const ctx = environment();
    const cookie = await authenticate(ctx);
    expect(cookieName(origin)).toBe("__Host-deepcuts-session");
    expect(sessionCookie(ctx.env, "x")).toContain("HttpOnly; SameSite=Strict");
    expect(sessionCookie(ctx.env, "x")).toContain("; Secure");
    expect(sessionCookie(ctx.env, "x")).not.toContain("Domain=");
    const token = cookie.split("=")[1];
    const row = ctx.sql.prepare("SELECT * FROM sessions").get()!;
    expect(row.token_hash).toBe(await digest(token));
    expect(row.token_hash).not.toBe(token);
    expect(
      (await ctx.request("/api/library", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(200);
    ctx.env.OWNER_KEY = "b".repeat(64);
    expect(
      (await ctx.request("/api/library", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
    ctx.env.OWNER_KEY = "a".repeat(64);
    ctx.sql.exec("UPDATE sessions SET expires_at=0");
    expect(
      (await ctx.request("/api/library", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
  });
  it("rejects cross-origin, missing-origin, wrong-key, and excessive login attempts", async () => {
    const ctx = environment();
    for (const Origin of ["https://attacker.example", "null", ""]) {
      expect(
        (
          await ctx.request("/api/login", {
            method: "POST",
            headers: { Origin, "Content-Type": "application/json" },
            body: '{"key":"x"}',
          })
        ).status,
      ).toBe(403);
    }
    expect(() =>
      assertOrigin(
        new Request(origin, {
          method: "POST",
          headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" },
        }),
        ctx.env,
      ),
    ).toThrow();
    expect(
      (
        await ctx.request("/api/login", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: '{"key":"wrong"}',
        })
      ).status,
    ).toBe(401);
    ctx.env.LOGIN_LIMIT.limit = async () => ({ success: false });
    expect(
      (
        await ctx.request("/api/login", {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
    ).toBe(429);
  });
  it("keeps partial imports hidden, verifies originals, commits once, and serves exact ranges", async () => {
    const ctx = environment();
    const cookie = await authenticate(ctx);
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    };
    const bytes = new TextEncoder().encode("ID3 synthetic audio payload");
    const data = {
      title: "Synthetic album",
      artist: "Test ensemble",
      year: 2026,
      tracks: [
        {
          title: "Test tone",
          artist: "Test ensemble",
          track_number: 1,
          disc_number: 1,
          duration: 8,
          filename: "01-test.mp3",
          mime: "audio/mpeg",
          bytes: bytes.length,
          sha256: await sha256(bytes.buffer),
        },
      ],
    };
    const created = await ctx.request("/api/imports", {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    expect(created.status).toBe(201);
    const result = (await created.json()) as {
      id: string;
      tracks: { id: string }[];
    };
    expect(
      await (await ctx.request("/api/library", { headers })).json(),
    ).toEqual({ albums: [] });
    const finish = () =>
      ctx.request(`/api/imports/${result.id}/complete`, {
        method: "POST",
        headers,
      });
    expect((await finish()).status).toBe(409);
    const path = `/api/imports/${result.id}/tracks/${result.tracks[0].id}`;
    expect(
      (await ctx.request(path, { method: "PUT", headers, body: "broken" }))
        .status,
    ).toBe(422);
    expect(ctx.objects.size).toBe(0);
    expect(
      (await ctx.request(path, { method: "PUT", headers, body: bytes })).status,
    ).toBe(200);
    expect(
      (await ctx.request(path, { method: "PUT", headers, body: bytes })).status,
    ).toBe(200);
    expect(ctx.objects.size).toBe(1);
    expect((await finish()).status).toBe(200);
    expect((await finish()).status).toBe(409);
    const media = `/api/tracks/${result.tracks[0].id}/audio`;
    const full = await ctx.request(media, { headers });
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
    const partial = await ctx.request(media, {
      headers: { ...headers, Range: "bytes=4-8" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(
      `bytes 4-8/${bytes.length}`,
    );
    expect(await partial.text()).toBe("synth");
    const suffix = await ctx.request(media, {
      headers: { ...headers, Range: "bytes=-7" },
    });
    expect(await suffix.text()).toBe("payload");
    expect(
      (
        await ctx.request(media, {
          headers: { ...headers, Range: "bytes=999-" },
        })
      ).status,
    ).toBe(416);
    expect(
      (
        await ctx.request(media, {
          headers: { ...headers, Range: "bytes=0-2", "If-Range": '"stale"' },
        })
      ).status,
    ).toBe(200);
    const head = await ctx.request(media, { method: "HEAD", headers });
    expect(head.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(await head.text()).toBe("");
    expect(
      (
        await ctx.request(`/api/imports/${result.id}`, {
          method: "DELETE",
          headers,
        })
      ).status,
    ).toBe(409);
    expect((await ctx.request("/api/not-real", { headers })).status).toBe(404);
  });
});
