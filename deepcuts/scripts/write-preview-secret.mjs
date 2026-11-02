import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const key = process.env.DEEPCUTS_PREVIEW_OWNER_KEY;
if (!/^[a-f0-9]{64}$/.test(key ?? "") || !process.env.RUNNER_TEMP)
  throw new Error(
    "Set a separate random 64-hex-character DEEPCUTS_PREVIEW_OWNER_KEY in the protected preview environment.",
  );
await writeFile(
  join(process.env.RUNNER_TEMP, "deepcuts-preview-secrets.json"),
  JSON.stringify({ OWNER_KEY: key }),
  { mode: 0o600 },
);
