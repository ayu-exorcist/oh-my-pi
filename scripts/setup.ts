import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { readSettings, writeSettings, confirm, isStringArray } from "./lib/pi-settings";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_SETTINGS = path.join(os.homedir(), ".pi", "agent", "settings.json");

async function main(): Promise<void> {
  const settings = await readSettings(GLOBAL_SETTINGS);
  const packages = isStringArray(settings.packages) ? [...settings.packages] : [];

  if (packages.includes(REPO_ROOT)) {
    console.log(`Already registered in ${GLOBAL_SETTINGS}`);
    console.log(`  path: ${REPO_ROOT}`);
    return;
  }

  console.log("The following change will be made:\n");
  console.log(`  file:    ${GLOBAL_SETTINGS}`);
  console.log(`  action:  add "${REPO_ROOT}" to packages\n`);

  const ok = await confirm("Proceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    process.exit(0);
  }

  settings.packages = [...packages, REPO_ROOT];
  await writeSettings(GLOBAL_SETTINGS, settings);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
