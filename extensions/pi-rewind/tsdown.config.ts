import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig } from "tsdown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageName(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (!isRecord(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
      return null;
    }
    return parsed.name;
  } catch {
    return null;
  }
}

const currentPackageName = readPackageName(process.cwd());
const packageNameCache = new Map<string, string | null>();

function toChunkBaseName(packageName: string): string {
  return packageName.replace("/", "__");
}

function getDependencyChunkName(moduleId: string): string | undefined {
  if (moduleId.startsWith("\0")) return undefined;

  let dir = dirname(resolve(moduleId));
  while (true) {
    const pkgJsonPath = join(dir, "package.json");
    const cached = packageNameCache.get(pkgJsonPath);
    if (cached !== undefined) {
      return cached && cached !== currentPackageName ? toChunkBaseName(cached) : undefined;
    }

    if (existsSync(pkgJsonPath)) {
      const packageName = readPackageName(dir);
      packageNameCache.set(pkgJsonPath, packageName);
      return packageName && packageName !== currentPackageName
        ? toChunkBaseName(packageName)
        : undefined;
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  outExtensions: () => ({ js: ".js" }),
  outputOptions(outputOptions) {
    return {
      ...outputOptions,
      entryFileNames: "[name].js",
      chunkFileNames: "[name].js",
      codeSplitting: {
        groups: [
          {
            name(moduleId) {
              return getDependencyChunkName(moduleId) ?? null;
            },
          },
        ],
      },
    };
  },
  dts: false,
  clean: true,
  deps: {
    alwaysBundle: ["@ayulab/pi-checkpoint"],
  },
});
