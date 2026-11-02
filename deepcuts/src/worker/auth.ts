import { timingSafeEqual } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { sha256 } from "../shared/model";

const encoder = new TextEncoder();
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const digest = (text: string) => sha256(encoder.encode(text).buffer);
export function configured(env: Env): boolean {
  return /^[a-f0-9]{64}$/.test(env.OWNER_KEY ?? "");
}
export function cookieName(origin: string): string {
  return new URL(origin).protocol === "https:"
    ? "__Host-deepcuts-session"
    : "deepcuts-local-session";
}
export function sessionCookie(
  env: Env,
  token: string,
  age = SESSION_SECONDS,
): string {
  const secure =
    new URL(env.APP_ORIGIN).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(env.APP_ORIGIN)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}
export function tokenFromRequest(request: Request, env: Env): string | null {
  const name = cookieName(env.APP_ORIGIN);
  const token = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function validSession(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!configured(env)) return false;
  const token = tokenFromRequest(request, env);
  if (!token) return false;
  return !!(await env.DB.prepare(
    "SELECT 1 FROM sessions WHERE token_hash = ? AND owner_key_hash = ? AND expires_at > ?",
  )
    .bind(
      await digest(token),
      await digest(env.OWNER_KEY),
      Math.floor(Date.now() / 1000),
    )
    .first());
}
export async function login(key: string, env: Env): Promise<string> {
  if (!configured(env))
    throw new HTTPException(503, {
      message: "Owner access is not configured.",
    });
  // Fixed-size digests avoid early-return comparisons. This is a random 256-bit
  // access key, not a human password, so no password KDF or registration is needed.
  const supplied = Buffer.from(await digest(key), "hex");
  const expected = Buffer.from(await digest(env.OWNER_KEY), "hex");
  if (!timingSafeEqual(supplied, expected))
    throw new HTTPException(401, {
      message: "That access key was not accepted.",
    });
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM sessions WHERE expires_at <= ? OR owner_key_hash != ?",
    ).bind(now, await digest(env.OWNER_KEY)),
    env.DB.prepare(
      "INSERT INTO sessions(token_hash, owner_key_hash, expires_at, created_at) VALUES(?,?,?,?)",
    ).bind(
      await digest(token),
      await digest(env.OWNER_KEY),
      now + SESSION_SECONDS,
      now,
    ),
  ]);
  return token;
}
export function assertOrigin(request: Request, env: Env) {
  const url = new URL(request.url);
  if (
    url.origin !== env.APP_ORIGIN ||
    request.headers.get("Origin") !== env.APP_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  ) {
    throw new HTTPException(403, {
      message: "Use Deep Cuts from its own origin.",
    });
  }
}
