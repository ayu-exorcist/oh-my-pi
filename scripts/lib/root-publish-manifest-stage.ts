import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "@ayulab/runtime-core";

export type StageRootPublishManifestResult =
  | { readonly ok: true; readonly restore: () => void }
  | { readonly ok: false; readonly message: string };

function removeWorkspaceDevDependencies(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const devDependencies = manifest.devDependencies;
  if (!isRecord(devDependencies)) return manifest;

  const filtered = Object.fromEntries(
    Object.entries(devDependencies).filter(
      ([, version]) => !String(version).startsWith("workspace:"),
    ),
  );

  if (Object.keys(filtered).length === Object.keys(devDependencies).length) return manifest;

  const updated = { ...manifest };
  if (Object.keys(filtered).length === 0) {
    delete updated.devDependencies;
  } else {
    updated.devDependencies = filtered;
  }
  return updated;
}

export function stageRootPublishManifest(root: string): StageRootPublishManifestResult {
  const packageJsonPath = join(root, "package.json");
  const original = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(original);

  if (!isRecord(parsed)) {
    return { ok: false, message: `❌ ${packageJsonPath} must contain a JSON object.` };
  }

  const staged = removeWorkspaceDevDependencies(parsed);
  if (staged !== parsed) {
    writeFileSync(packageJsonPath, `${JSON.stringify(staged, null, 2)}\n`);
  }

  return {
    ok: true,
    restore: () => writeFileSync(packageJsonPath, original),
  };
}
