import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function toChunkBaseName(packageName: string): string {
  return packageName.replace("/", "__");
}

export function createDependencyChunkNamer(
  currentDir = process.cwd(),
): (moduleId: string) => string | undefined {
  const currentPackageName = readPackageName(currentDir);
  const packageNameCache = new Map<string, string | null>();

  return (moduleId: string): string | undefined => {
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
  };
}

export interface TsdownConfigOptions {
  readonly entry?: readonly string[];
  readonly dts?: boolean;
  readonly alwaysBundle?: readonly string[];
  readonly dependencyChunks?: boolean;
}

interface OutputOptions {
  readonly [key: string]: unknown;
}

export function createTsdownConfig(options: TsdownConfigOptions = {}): Record<string, unknown> {
  const deps =
    options.alwaysBundle && options.alwaysBundle.length > 0
      ? { deps: { alwaysBundle: [...options.alwaysBundle] } }
      : {};

  const base = {
    entry: [...(options.entry ?? ["src/index.ts"])],
    format: "esm",
    outExtensions: () => ({ js: ".js" }),
    dts: options.dts ?? false,
    clean: true,
    ...deps,
  };

  if (!options.dependencyChunks) return base;

  const getDependencyChunkName = createDependencyChunkNamer();

  return {
    ...base,
    outputOptions(outputOptions: OutputOptions) {
      return {
        ...outputOptions,
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        codeSplitting: {
          groups: [
            {
              name(moduleId: string) {
                return getDependencyChunkName(moduleId) ?? null;
              },
            },
          ],
        },
      };
    },
  };
}
