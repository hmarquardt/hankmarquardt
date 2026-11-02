import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = new URL("../dist/", import.meta.url);
await mkdir(new URL("icons/", root), { recursive: true });
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["apple-touch-icon", 180],
]) {
  await sharp(await readFile(new URL("icon.svg", root)))
    .resize(size, size)
    .png()
    .toFile(new URL(`icons/${name}.png`, root).pathname);
}
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      result.push(
        ...(await files(
          new URL(`${entry.name}/`, directory),
          `${prefix}${entry.name}/`,
        )),
      );
    else if (entry.name !== "sw.js") result.push(`/${prefix}${entry.name}`);
  }
  return result;
}
const assets = (await files(root)).sort();
const digest = createHash("sha256");
for (const file of assets) {
  digest.update(file);
  digest.update(await readFile(new URL(file.slice(1), root)));
}
const revision = digest.digest("hex").slice(0, 16);
const source = `// Generated public-shell cache only. Never cache APIs, artwork or audio.\n
const CACHE = 'deepcuts-shell-${revision}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async asset => {
      // Static Assets canonicalizes /index.html to /. A redirected response
      // cannot satisfy a navigation with redirect mode 'manual' when offline.
      const response = await fetch(asset === '/index.html' ? '/' : asset, { cache: 'reload', credentials: 'omit' });
      if (!response.ok) throw new Error('Shell installation failed.');
      const headers = new Headers(response.headers);
      for (const name of ['Content-Encoding', 'Content-Length', 'Transfer-Encoding']) headers.delete(name);
      await cache.put(asset, new Response(response.body, { status: response.status, headers }));
    }));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('deepcuts-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(cached => cached || fetch(event.request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});
`;
await writeFile(new URL("sw.js", root), source);
console.log(
  `PWA shell ${revision}: ${assets.length} local assets, PNG installation icons, no private response caching.`,
);
