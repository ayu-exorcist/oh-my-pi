import path from "node:path";
import os from "node:os";

import { confirm, isStringArray, readSettings, writeSettings } from "./pi-settings";

export type PackageRegistrationAction = "add" | "remove";

export interface PackageRegistrationOptions {
  readonly action: PackageRegistrationAction;
  readonly repoRoot: string;
}

const GLOBAL_SETTINGS = path.join(os.homedir(), ".pi", "agent", "settings.json");

function describeAction(action: PackageRegistrationAction): string {
  return action === "add" ? "add" : "remove";
}

export async function updatePackageRegistration(
  options: PackageRegistrationOptions,
): Promise<void> {
  const settings = await readSettings(GLOBAL_SETTINGS);
  const packages = isStringArray(settings.packages) ? [...settings.packages] : [];
  const registered = packages.includes(options.repoRoot);

  if (options.action === "add" && registered) {
    console.log(`Already registered in ${GLOBAL_SETTINGS}`);
    console.log(`  path: ${options.repoRoot}`);
    return;
  }

  if (options.action === "remove" && !registered) {
    console.log(`Not registered in ${GLOBAL_SETTINGS}`);
    console.log(`  path: ${options.repoRoot}`);
    return;
  }

  console.log("The following change will be made:\n");
  console.log(`  file:    ${GLOBAL_SETTINGS}`);
  console.log(
    `  action:  ${describeAction(options.action)} "${options.repoRoot}" ${
      options.action === "add" ? "to" : "from"
    } packages\n`,
  );

  const ok = await confirm("Proceed? [y/N] ");
  if (!ok) {
    console.log("Aborted. No changes were made.");
    process.exit(0);
  }

  settings.packages =
    options.action === "add"
      ? [...packages, options.repoRoot]
      : packages.filter((packagePath) => packagePath !== options.repoRoot);
  await writeSettings(GLOBAL_SETTINGS, settings);
  console.log("Done.");
}
