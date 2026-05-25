import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root absolute path. */
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Simple CLI parser for --key, --key=value, -k, and -k value flags. */
function parseCLI() {
  let args = process.argv.slice(2);
  // pnpm may pass a leading `--` separator; drop it if present.
  if (args[0] === "--") args = args.slice(1);

  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags.set(a.slice(2), next);
          i++;
        } else {
          flags.set(a.slice(2), true);
        }
      }
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      const key = a[1];
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    positionals.push(a);
  }

  return { flags, positionals };
}

const { flags, positionals } = parseCLI();

const DRY_RUN = flags.has("dry-run");
const ALL = flags.has("all") || flags.has("a");
const ACCESS = typeof flags.get("access") === "string" ? String(flags.get("access")) : "public";
const OTP = typeof flags.get("otp") === "string" ? String(flags.get("otp")) : undefined;

// Package target(s) from -p / --package flag.
let TARGETS: string[] = [];
const pkgFlag = flags.get("package") ?? flags.get("p");
if (pkgFlag) {
  TARGETS = String(pkgFlag)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
} else if (positionals.length > 0) {
  // Back-compat: bare positional args are also treated as targets.
  TARGETS = positionals;
}

// If neither --all nor --package/positional targets were provided,
// default to all out-of-date packages for backwards compatibility.
const PUBLISH_ALL = ALL || TARGETS.length === 0;

/** Directories scanned for workspace packages (excluding the root). */
const WORKSPACE_DIRS = ["extensions", "sdk"];

interface PkgJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  private?: boolean;
  bundledDependencies?: unknown;
  [key: string]: unknown;
}

interface PackageInfo {
  name: string;
  version: string;
  path: string;
  pkg: PkgJson;
  isRoot: boolean;
}

/** Narrow `unknown` to `string[]`. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Narrow `unknown` to a plain object (not array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to a valid parsed `package.json` shape. */
function isPkgJson(value: unknown): value is PkgJson {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.version === "string";
}

/** Read the root `package.json` when it is not marked private. */
function getRootPackage(): PackageInfo | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!isPkgJson(parsed) || parsed.private) return null;
  return {
    name: parsed.name,
    version: parsed.version,
    path: root,
    pkg: parsed,
    isRoot: true,
  };
}

/** Discover publishable packages inside `extensions/` and `sdk/`. */
function getWorkspacePackages(): PackageInfo[] {
  const packages: PackageInfo[] = [];
  for (const dir of WORKSPACE_DIRS) {
    const fullDir = resolve(root, dir);
    if (!existsSync(fullDir)) continue;
    for (const sub of readdirSync(fullDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pkgPath = join(fullDir, sub.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (!isPkgJson(parsed) || parsed.private) continue;
      const pkg = parsed;
      packages.push({
        name: pkg.name,
        version: pkg.version,
        path: join(fullDir, sub.name),
        pkg,
        isRoot: false,
      });
    }
  }
  return packages;
}

/** Return every publishable package (workspace + root). */
function getPackages(): PackageInfo[] {
  const rootPkg = getRootPackage();
  const workspacePkgs = getWorkspacePackages();
  if (rootPkg) {
    return [...workspacePkgs, rootPkg];
  }
  return workspacePkgs;
}

/** Query npm for the latest published version of a package. */
function getRegistryVersion(name: string): string | null {
  try {
    const output = execSync(`npm view ${name} version`, {
      encoding: "utf8",
      cwd: root,
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim();
  } catch {
    return null;
  }
}

/** Check whether a package should be published (version mismatch or not yet published). */
function shouldPublish(pkg: PackageInfo, registryVersion: string | null): boolean {
  return pkg.version !== registryVersion;
}

interface DepGraph {
  graph: Map<string, string[]>;
  inDegree: Map<string, number>;
  nameMap: Map<string, PackageInfo>;
}

/**
 * Build a dependency graph from workspace `dependencies`.
 *
 * Edges point from a dependency → the package that depends on it so that
 * topological sorting yields dependents *after* their dependencies.
 */
function buildDepGraph(packages: PackageInfo[]): DepGraph {
  const nameMap = new Map(packages.map((p) => [p.name, p]));
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const pkg of packages) {
    graph.set(pkg.name, []);
    inDegree.set(pkg.name, 0);
  }

  for (const pkg of packages) {
    const deps = pkg.pkg.dependencies || {};
    for (const depName of Object.keys(deps)) {
      if (nameMap.has(depName)) {
        graph.get(depName)!.push(pkg.name);
        inDegree.set(pkg.name, inDegree.get(pkg.name)! + 1);
      }
    }
  }

  return { graph, inDegree, nameMap };
}

/**
 * Kahn's algorithm — return `names` ordered so that dependencies come first.
 */
function topoSort(
  names: string[],
  graph: Map<string, string[]>,
  baseInDegree: Map<string, number>,
): string[] {
  const inDegree = new Map(baseInDegree);
  const queue = [...names].filter((n) => inDegree.get(n) === 0);
  const result: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);
    result.push(name);
    for (const child of graph.get(name)!) {
      const newDegree = inDegree.get(child)! - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0 && !visited.has(child)) {
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Recursively collect all workspace dependencies of `target` (transitive closure).
 */
function collectDependencies(
  target: string,
  nameMap: Map<string, PackageInfo>,
  visited = new Set<string>(),
): Set<string> {
  if (visited.has(target)) return visited;
  visited.add(target);
  const pkg = nameMap.get(target);
  const deps = pkg?.pkg.dependencies || {};
  for (const depName of Object.keys(deps)) {
    if (nameMap.has(depName)) collectDependencies(depName, nameMap, visited);
  }
  return visited;
}

/**
 * Build a Markdown changelog entry listing every bundled dependency
 * and the exact version that was just published.
 */
function generateChangelogEntry(
  rootPkg: PackageInfo,
  publishedVersions: Map<string, string>,
): string {
  const date = new Date().toISOString().split("T")[0];
  const deps = rootPkg.pkg.dependencies || {};
  const bundled: string[] = isStringArray(rootPkg.pkg.bundledDependencies)
    ? rootPkg.pkg.bundledDependencies
    : [];

  const lines: string[] = [];
  lines.push(`## ${rootPkg.name}@${rootPkg.version} (${date})`);
  lines.push("");

  for (const dep of bundled) {
    const version = publishedVersions.get(dep) || deps[dep] || "unknown";
    lines.push(`- ${dep}@${version}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Prepend the new changelog entry to `CHANGELOG.md`. */
function updateChangelog(rootPkg: PackageInfo, publishedVersions: Map<string, string>): void {
  const changelogPath = join(root, "CHANGELOG.md");
  const entry = generateChangelogEntry(rootPkg, publishedVersions);

  let existing = "";
  try {
    existing = readFileSync(changelogPath, "utf8");
  } catch {
    existing = "# Changelog\n\n";
  }

  const newContent = existing.replace(/# Changelog\n\n/, `# Changelog\n\n${entry}`);
  writeFileSync(changelogPath, newContent, "utf8");
  console.log("📝 Updated CHANGELOG.md\n");
}

/**
 * Orchestrate the release:
 *
 *   1. Detect packages whose local version differs from the registry.
 *   2. If explicit targets were given, narrow to their dependency closure.
 *   3. Topologically sort so dependencies publish first.
 *   4. Run `pnpm publish` for each package.
 *   5. Update `CHANGELOG.md` after the root package is published.
 */
async function main(): Promise<void> {
  const packages = getPackages();
  const { graph, inDegree, nameMap } = buildDepGraph(packages);

  // Step 1 — detect version drift
  const needsPublish = new Map<string, string | null>();
  for (const pkg of packages) {
    const registryVersion = getRegistryVersion(pkg.name);
    if (shouldPublish(pkg, registryVersion)) {
      needsPublish.set(pkg.name, registryVersion);
    }
  }

  let toPublish = new Set(needsPublish.keys());

  if (!PUBLISH_ALL) {
    // -p / --package was explicitly set; -a was not.
    for (const target of TARGETS) {
      if (!nameMap.has(target)) {
        console.error(`❌ Unknown package: ${target}`);
        process.exit(1);
      }
    }

    const allowed = new Set<string>();
    for (const target of TARGETS) {
      for (const dep of collectDependencies(target, nameMap)) {
        allowed.add(dep);
      }
    }

    // Narrow existing drift list to allowed packages, then supplement
    // any allowed package that has never been published.
    toPublish = new Set([...toPublish].filter((n) => allowed.has(n)));
    for (const name of allowed) {
      if (toPublish.has(name)) continue;
      const registryVersion = getRegistryVersion(name);
      if (registryVersion === null) {
        toPublish.add(name);
        needsPublish.set(name, null);
      }
    }
  }

  if (toPublish.size === 0) {
    console.log("✅ All packages are up to date. Nothing to publish.");
    return;
  }

  const sorted = topoSort([...nameMap.keys()], graph, inDegree);
  const sortedToPublish = sorted.filter((n) => toPublish.has(n));

  console.log(`📦 Packages to publish (${sortedToPublish.length}):`);
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    const registryVersion = needsPublish.get(name) ?? getRegistryVersion(name);
    console.log(`  ${name}@${pkg?.version} (registry: ${registryVersion || "not published"})`);
  }

  if (DRY_RUN) {
    console.log("\n🏃 Dry run mode. No packages were actually published.");
    return;
  }

  console.log("");
  const publishedVersions = new Map<string, string>();
  for (const name of sortedToPublish) {
    const pkg = nameMap.get(name);
    if (!pkg) continue;

    if (pkg.isRoot) {
      console.log(`🚀 Publishing root package ${name}@${pkg.version}...`);
    } else {
      console.log(`🚀 Publishing ${name}@${pkg.version}...`);
    }

    try {
      const otpFlag = OTP ? ` --otp ${OTP}` : "";
      const env = OTP ? { ...process.env, PNPM_CONFIG_OTP: OTP } : undefined;
      execSync(`pnpm publish --access ${ACCESS}${otpFlag}`, {
        cwd: pkg.path,
        stdio: "inherit",
        env,
      });
      console.log(`✅ Published ${name}@${pkg.version}\n`);
      publishedVersions.set(name, pkg.version);
    } catch {
      console.error(`❌ Failed to publish ${name}`);
      process.exit(1);
    }
  }

  // Generate changelog after root package is published
  const rootPkg = packages.find((p) => p.isRoot);
  if (rootPkg && publishedVersions.has(rootPkg.name)) {
    updateChangelog(rootPkg, publishedVersions);
  }

  console.log("🎉 All packages published successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
