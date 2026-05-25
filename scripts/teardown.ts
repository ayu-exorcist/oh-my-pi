import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_SETTINGS = path.join(os.homedir(), ".pi", "agent", "settings.json");

async function readSettings(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

async function writeSettings(filePath: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function confirm(msg: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(msg, (ans) => resolve(ans.trim()));
    });
    return answer.toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const settings = await readSettings(GLOBAL_SETTINGS);
  const packages = isStringArray(settings.packages) ? [...settings.packages] : [];

  if (!packages.includes(REPO_ROOT)) {
    console.log(`Not registered in ${GLOBAL_SETTINGS}`);
    console.log(`  path: ${REPO_ROOT}`);
    return;
  }

  console.log("The following change will be made:\n");
  console.log(`  file:    ${GLOBAL_SETTINGS}`);
  console.log(`  action:  remove "${REPO_ROOT}" from packages\n`);

  const ok = await confirm("Proceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    process.exit(0);
  }

  settings.packages = packages.filter((p) => p !== REPO_ROOT);
  await writeSettings(GLOBAL_SETTINGS, settings);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
