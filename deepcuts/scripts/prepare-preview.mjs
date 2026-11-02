import { readFile, writeFile } from "node:fs/promises";

// No network or infrastructure creation. A dispatch supplies reviewed, existing
// preview resources; names and origins cannot target the personal-site Worker.
export function previewConfig(template, variables) {
  const {
    DEEPCUTS_ACCOUNT_ID: account,
    DEEPCUTS_PREVIEW_D1_ID: database,
    DEEPCUTS_PREVIEW_ORIGIN: origin,
  } = variables;
  if (!/^[a-f0-9]{32}$/.test(account ?? ""))
    throw new Error(
      "Set DEEPCUTS_ACCOUNT_ID to the reviewed Cloudflare account.",
    );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      database ?? "",
    )
  )
    throw new Error(
      "Set DEEPCUTS_PREVIEW_D1_ID to an existing dedicated preview database UUID.",
    );
  if (
    !/^https:\/\/deepcuts-preview\.[a-z0-9-]+\.workers\.dev$/.test(origin ?? "")
  )
    throw new Error(
      "The preview origin must be https://deepcuts-preview.<account-subdomain>.workers.dev with no trailing slash.",
    );
  if (
    template.name !== "deepcuts-preview" ||
    template.routes.length ||
    template.d1_databases[0].database_name !== "deepcuts-preview" ||
    template.r2_buckets[0].bucket_name !== "deepcuts-preview-originals"
  )
    throw new Error("Unsafe preview resource identity.");
  const config = structuredClone(template);
  config.account_id = account;
  config.d1_databases[0].database_id = database;
  config.vars.APP_ORIGIN = origin;
  return config;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const template = JSON.parse(
    await readFile(
      new URL("../wrangler.preview.json", import.meta.url),
      "utf8",
    ),
  );
  const config = previewConfig(template, process.env);
  await writeFile(
    new URL("../wrangler.preview.generated.json", import.meta.url),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  console.log(
    "Prepared deepcuts-preview config with existing preview bindings. Nothing deployed.",
  );
}
