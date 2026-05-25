import { execSync } from "node:child_process";

/** Repository root absolute path — injected by caller. */
let rootPath = process.cwd();

export function setRoot(path: string): void {
  rootPath = path;
}

/** Query npm for the latest published version of a package. */
export function getRegistryVersion(name: string): string | null {
  try {
    const output = execSync(`npm view ${name} version`, {
      encoding: "utf8",
      cwd: rootPath,
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim();
  } catch {
    return null;
  }
}
