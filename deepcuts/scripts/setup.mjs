import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
try {
  await access(new URL("../.dev.vars", import.meta.url));
} catch {
  await writeFile(
    new URL("../.dev.vars", import.meta.url),
    `# Local development only. Never commit or reuse for preview.\nOWNER_KEY=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created a random local owner key in deepcuts/.dev.vars. Copy it into the local sign-in form.",
  );
}
