import assert from "node:assert/strict";

const origin = "https://deepcuts.hankmarquardt.com";
const expected = process.env.GITHUB_SHA;
assert.match(expected ?? "", /^[a-f0-9]{40}$/, "Missing committed release SHA");

async function check(path, expectedStatus) {
  const response = await fetch(origin + path, {
    redirect: "manual",
    headers: { "Cache-Control": "no-cache" },
  });
  assert.equal(response.status, expectedStatus, `${path}: unexpected HTTP status`);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  return response;
}

const version = await (await check("/api/version", 200)).json();
assert.deepEqual(version, { app: "deepcuts", revision: expected });

for (const path of [
  "/api/library",
  "/api/session",
  "/api/imports",
  "/api/playlists",
  "/api/state",
  "/api/tracks/missing/audio",
]) {
  const response = await check(path, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}

const shell = await check("/", 200);
const csp = shell.headers.get("Content-Security-Policy") ?? "";
assert.ok(csp.includes("script-src 'self'"), "Missing expected CSP");
const html = await shell.text();
assert.ok(html.includes("Deep Cuts"));
const manifest = await (await check("/manifest.webmanifest", 200)).json();
assert.equal(manifest.display, "standalone");
await check("/sw.js", 200);
console.log(`PASS: Deep Cuts production release ${expected}, private APIs and PWA assets`);
