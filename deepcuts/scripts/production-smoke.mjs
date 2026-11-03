import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

let phase = "configuration";
process.on("uncaughtException", () => {
  console.error(
    `FAIL: production smoke during ${phase}. Exception details suppressed to protect production credentials.`,
  );
  process.exit(1);
});

const origin = "https://deepcuts.hankmarquardt.com";
const expected = process.env.DEEPCUTS_REVISION;
assert.match(
  expected ?? "",
  /^[a-f0-9]{40}$/,
  "Set DEEPCUTS_REVISION to the committed release SHA.",
);
const secrets = JSON.parse(
  await readFile(
    new URL("../.production/secrets.json", import.meta.url),
    "utf8",
  ),
);
const key = secrets.OWNER_KEY;
assert.ok(
  /^[a-f0-9]{64}$/.test(key ?? ""),
  "A separate production owner key is required.",
);

async function check(path, status = 200, options) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    ...options,
  });
  assert.equal(response.status, status, `${path} returned unexpected status`);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  return response;
}
phase = "version and unauthenticated access checks";
const version = await (await check("/api/version")).json();
assert.deepEqual(version, { app: "deepcuts", revision: expected });
for (const path of [
  "/api/library",
  "/api/session",
  "/api/imports",
  "/api/state",
  "/api/tracks/missing/audio",
  "/api/albums/missing/artwork",
]) {
  const response = await check(path, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}
await check("/api/tracks/missing/audio", 401, { method: "HEAD" });
const json = (body, extra = {}) => ({
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", ...extra },
  body: JSON.stringify(body),
});
await check(
  "/api/login",
  403,
  json(
    { key: "deliberately-invalid" },
    { Origin: "https://untrusted.example" },
  ),
);
await check("/api/login", 401, json({ key: "deliberately-invalid" }));
phase = "authenticated API login, secure cookies and revocation";
const login = await check("/api/login", 200, json({ key }));
const cookie = login.headers.get("Set-Cookie");
assert.ok(/^__Host-deepcuts-session=[a-f0-9]{64};/.test(cookie ?? ""));
for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
  assert.ok(cookie.includes(flag), `Missing cookie flag ${flag}`);
assert.ok(!cookie.includes("Domain="));
const headers = { Cookie: cookie.split(";")[0] };
assert.deepEqual(await (await check("/api/session", 200, { headers })).json(), {
  authenticated: true,
});
const library = await (await check("/api/library", 200, { headers })).json();
assert.ok(
  Array.isArray(library.albums),
  "Authenticated library did not return albums.",
);
assert.ok(
  Array.isArray(
    (await (await check("/api/imports", 200, { headers })).json()).imports,
  ),
);
await check("/api/state", 200, { headers });
await check("/api/tracks/missing/audio", 404, { headers });
await check("/api/logout", 200, {
  method: "POST",
  headers: { ...headers, Origin: origin },
});
await check("/api/session", 401, { headers });
console.log(
  "PASS: release version, secure login/logout, revocation, same-origin enforcement and private API/media access.",
);

phase = "public shell and PWA assets";
const shell = await check("/");
assert.ok(
  shell.headers.get("Content-Security-Policy").includes("script-src 'self'"),
);
const html = await shell.text();
assert.ok(html.includes("Deep Cuts"));
assert.ok(!html.includes(key));
const manifest = await (await check("/manifest.webmanifest")).json();
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "/");
for (const icon of manifest.icons) {
  const bytes = new Uint8Array(await (await check(icon.src)).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))
  await check(match[1]);
const sw = await check("/sw.js");
assert.match(sw.headers.get("Content-Type"), /javascript/);
assert.ok((await sw.text()).includes("deepcuts-shell-"));
await check("/icons/apple-touch-icon.png");
console.log(
  "PASS: shell, CSP, hashed JS/CSS, manifest, PNG installation icons and service worker.",
);

// Production credentials never enter screenshots, traces, videos, reports or logs.
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [
    ["mobile", devices["Pixel 7"]],
    ["desktop", { viewport: { width: 1440, height: 1000 } }],
  ]) {
    phase = `${name} production browser sign-in, library, PWA cache and sign-out`;
    const context = await browser.newContext(viewport);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.name));
    try {
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.getByLabel("Your access key").fill(key);
      await page.getByRole("button", { name: "Open my library" }).click();
      await page.getByRole("heading", { name: "Your collection." }).waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.evaluate(async () => {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Service worker not ready")),
              20000,
            ),
          ),
        ]);
      });
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const paths = await page.evaluate(async () => {
        const paths = [];
        for (const cache of await caches.keys())
          for (const request of await (await caches.open(cache)).keys())
            paths.push(new URL(request.url).pathname);
        return paths;
      });
      assert.ok(paths.includes("/index.html"));
      assert.ok(paths.every((path) => !path.startsWith("/api/")));
      await page
        .getByRole("button", { name: /Sign out/ })
        .filter({ visible: true })
        .click();
      await page.getByRole("button", { name: "Open my library" }).waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `PASS: ${name} production sign-in, library render, responsive layout, public-only PWA cache and sign-out.`,
      );
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(
  `Production smoke passed for Deep Cuts revision ${expected}. No music or import data was written.`,
);
