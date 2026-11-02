import { readFile } from "node:fs/promises";

export async function verifyResources(config, token, fetcher = fetch) {
  if (
    !token ||
    config.name !== "deepcuts-preview" ||
    config.routes.length ||
    config.d1_databases[0].database_name !== "deepcuts-preview" ||
    config.r2_buckets[0].bucket_name !== "deepcuts-preview-originals"
  )
    throw new Error("Unsafe or incomplete preview configuration.");
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}`;
  const resources = [
    [
      `${base}/d1/database/${config.d1_databases[0].database_id}`,
      "deepcuts-preview",
    ],
    [
      `${base}/r2/buckets/deepcuts-preview-originals`,
      "deepcuts-preview-originals",
    ],
  ];
  const results = await Promise.allSettled(
    resources.map(async ([url, name]) => {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok || !body.success || body.result?.name !== name)
        throw new Error(
          `Existing preview resource identity check failed for ${name}. No writes are permitted.`,
        );
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const config = JSON.parse(
    await readFile(
      new URL("../wrangler.preview.generated.json", import.meta.url),
      "utf8",
    ),
  );
  await verifyResources(config, process.env.CLOUDFLARE_API_TOKEN);
  console.log(
    "Existing preview D1 and R2 bucket identities verified by read-only API checks.",
  );
}
