import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { previewConfig } from "../../scripts/prepare-preview.mjs";
import { verifyResources } from "../../scripts/preflight-preview.mjs";

const read = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const template = await read("../../wrangler.preview.json");
const vars = {
  DEEPCUTS_ACCOUNT_ID: "a".repeat(32),
  DEEPCUTS_PREVIEW_D1_ID: "12345678-1234-4234-8234-123456789abc",
  DEEPCUTS_PREVIEW_ORIGIN: "https://deepcuts-preview.test-account.workers.dev",
};
test("environment identities and resources are independent of the personal site", async () => {
  const configs = await Promise.all(
    ["wrangler.json", "wrangler.preview.json", "wrangler.production.json"].map(
      (name) => read(`../../${name}`),
    ),
  );
  const site = await read("../../../wrangler.json");
  assert.equal(new Set(configs.map((c) => c.name)).size, 3);
  assert.equal(
    new Set(configs.map((c) => c.r2_buckets[0].bucket_name)).size,
    3,
  );
  for (const config of configs) {
    assert.notEqual(config.name, site.name);
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.main, "src/worker/index.ts");
  }
  assert.deepEqual(configs[1].routes, []);
  assert.deepEqual(configs[2].routes, [
    {
      pattern: "deepcuts.hankmarquardt.com",
      zone_id: "1d02b937540d58cb201c4abcbb7df4d1",
      custom_domain: true,
    },
  ]);
});
test("preview generation requires exact existing-resource UUID and isolated HTTPS origin", () => {
  const config = previewConfig(template, vars);
  assert.equal(config.name, "deepcuts-preview");
  assert.equal(config.vars.APP_ORIGIN, vars.DEEPCUTS_PREVIEW_ORIGIN);
  for (const value of [
    "https://hankmarquardt.com",
    "https://deepcuts.hankmarquardt.com",
    "http://deepcuts-preview.a.workers.dev",
    "https://deepcuts-preview.a.workers.dev/",
  ]) {
    assert.throws(() =>
      previewConfig(template, { ...vars, DEEPCUTS_PREVIEW_ORIGIN: value }),
    );
  }
  assert.throws(() =>
    previewConfig(template, {
      ...vars,
      DEEPCUTS_PREVIEW_D1_ID: "00000000-0000-0000-0000-000000000000",
    }),
  );
  assert.throws(() =>
    previewConfig({ ...template, name: "hankmarquardt" }, vars),
  );
});
test("resource preflight only reads the reviewed account and existing preview resources", async () => {
  const config = previewConfig(template, vars);
  const urls = [];
  await verifyResources(config, "test-only-token", async (url, options) => {
    urls.push(url);
    assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    return Response.json({
      success: true,
      result: {
        name: url.includes("/d1/")
          ? "deepcuts-preview"
          : "deepcuts-preview-originals",
      },
    });
  });
  assert.equal(urls.length, 2);
  assert.ok(
    urls.every((url) =>
      url.startsWith(
        `https://api.cloudflare.com/client/v4/accounts/${vars.DEEPCUTS_ACCOUNT_ID}/`,
      ),
    ),
  );
});
test("a production database ID or missing preview bucket cannot pass remote identity checks", async () => {
  const config = previewConfig(template, vars);
  await assert.rejects(
    verifyResources(config, "test-only-token", async () =>
      Response.json({ success: true, result: { name: "deepcuts" } }),
    ),
    /identity check failed/,
  );
  await assert.rejects(
    verifyResources(config, "test-only-token", async () =>
      Response.json({ success: false }, { status: 404 }),
    ),
    /identity check failed/,
  );
});
test("only the exact reviewed additive migrations can reach preview", async () => {
  const approved = await read("../../docs/preview-migration.json");
  const files = (
    await readdir(new URL("../../migrations/", import.meta.url))
  ).sort();
  assert.deepEqual(files, Object.keys(approved));
  for (const file of files)
    assert.equal(
      createHash("sha256")
        .update(
          await readFile(new URL(`../../migrations/${file}`, import.meta.url)),
        )
        .digest("hex"),
      approved[file],
    );
});
test("CI isolates gated preview and production releases from the personal site", async () => {
  const workflow = await readFile(
    new URL("../../../.github/workflows/deepcuts.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /inputs\.deploy_preview == true/);
  assert.match(workflow, /DEEPCUTS_PREVIEW_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /environment: deepcuts-preview/);
  assert.match(workflow, /preflight-preview\.mjs/);
  assert.match(workflow, /--no-x-provision --no-x-auto-create/);
  assert.match(workflow, /DEEPCUTS_PRODUCTION_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /environment: deepcuts-production/);
  assert.match(workflow, /secrets\\.DEEPCUTS_PRODUCTION_API_TOKEN/);
  assert.match(workflow, /wrangler\\.production\\.json/);
  assert.match(workflow, /verify-production-ci\\.mjs/);
  assert.doesNotMatch(workflow, /secrets\\.CLOUDFLARE_API_TOKEN/);
  const personalWorkflow = await readFile(
    new URL("../../../.github/workflows/site.yml", import.meta.url),
    "utf8",
  );
  assert.match(personalWorkflow, /paths-ignore:/);
  assert.match(personalWorkflow, /deepcuts\\/\\*\\*/);
});
