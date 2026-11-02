const origin = process.env.DEEPCUTS_PREVIEW_ORIGIN;
const revision = process.env.GITHUB_SHA;
if (
  !/^https:\/\/deepcuts-preview\.[a-z0-9-]+\.workers\.dev$/.test(
    origin ?? "",
  ) ||
  !/^[a-f0-9]{40}$/.test(revision ?? "")
)
  throw new Error("Expected a preview origin and exact Git revision.");
const version = await fetch(`${origin}/api/version`);
const body = await version.json();
if (!version.ok || body.app !== "deepcuts" || body.revision !== revision)
  throw new Error("Preview revision does not match this release.");
const library = await fetch(`${origin}/api/library`);
if (
  library.status !== 401 ||
  library.headers.get("Cache-Control") !== "no-store"
)
  throw new Error("Preview library must require authentication.");
const shell = await fetch(origin);
if (
  !shell.ok ||
  !shell.headers.get("Content-Security-Policy")?.includes("script-src 'self'")
)
  throw new Error("Preview shell or security headers failed.");
console.log(
  `Verified Deep Cuts preview revision ${revision}, private library, and shell headers.`,
);
