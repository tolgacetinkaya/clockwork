import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startPanel } from "../packages/panel/src/index.js";

const projectDir = resolve(process.env.PANEL_PROJECT_DIR ?? "/data");
const stateDir = join(projectDir, ".teamsmith");
const port = Number(process.env.PANEL_PORT ?? "47831");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PANEL_PORT");
await mkdir(stateDir, { recursive: true });

let hasLedger = true;
try { await access(join(stateDir, "ledger.jsonl")); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  hasLedger = false;
}
const seed = process.env.PANEL_SEED_DIR;
if (!hasLedger && seed) {
  // Copy history once; never mount the original evidence as writable state.
  for (const name of await readdir(seed)) {
    if (name === "ledger.jsonl" || /^spec\.v\d+\.yaml$/.test(name)) {
      await copyFile(join(seed, name), join(stateDir, name));
    }
  }
  console.log("Demo seeded from archived evidence; no orchestrator or model is running.");
}
try {
  await writeFile(join(stateDir, "control.json"), JSON.stringify({ paused: false, kill: false }), { flag: "wx" });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}

const panel = await startPanel({ projectDir, port, host: "0.0.0.0", demo: Boolean(seed) });
console.log(`Clockwork panel listening on 0.0.0.0:${port}; state: ${projectDir}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void panel.close().then(() => process.exit(0)); });
}
