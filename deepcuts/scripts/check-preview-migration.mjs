import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
const directory = new URL("../migrations/", import.meta.url);
const files = (await readdir(directory)).sort();
const approved = JSON.parse(
  await readFile(
    new URL("../docs/preview-migration.json", import.meta.url),
    "utf8",
  ),
);
if (JSON.stringify(files) !== JSON.stringify(Object.keys(approved)))
  throw new Error(
    "Preview migration set changed. Review the migration and recovery plan before release.",
  );
for (const file of files) {
  const bytes = await readFile(new URL(file, directory));
  if (createHash("sha256").update(bytes).digest("hex") !== approved[file])
    throw new Error(
      "Preview migration content changed. Explicit review is required.",
    );
}
console.log("Migrations match the reviewed additive set.");
