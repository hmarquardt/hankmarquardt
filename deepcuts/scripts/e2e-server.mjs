import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

// Each run gets fresh emulated resources. Never reset the developer's local
// library, and never let fixtures from an earlier run change test results.
const state = `.wrangler/e2e/${randomUUID()}`;
const cli = "node_modules/wrangler/bin/wrangler.js";
const common = ["--config", "wrangler.json", "--persist-to", state];
let child;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child?.kill(signal));
}
async function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0 || signal) resolve();
      else reject(new Error(`Local Wrangler exited with status ${code}.`));
    });
  });
}
await run(["d1", "migrations", "apply", "DB", "--local", ...common]);
await run(["dev", ...common, "--ip", "127.0.0.1", "--port", "8788"]);
