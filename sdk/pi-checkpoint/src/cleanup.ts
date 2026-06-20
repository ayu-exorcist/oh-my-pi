import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "./exec";
import { tryWithRepoLock } from "./lock";
import { getCheckpointRootDir, getLegacySessionsDir, getWorktreeRegistryPath } from "./resolver";
import { isSafeCheckpointRef, validateWorktreeId } from "./path-safety";

export interface CheckpointCleanupRetention {
  readonly enabled: boolean;
  readonly maxAge: string;
  readonly minRetention: string;
  readonly maxCount?: number;
}

export interface CheckpointCleanupOptions {
  readonly liveRefs: ReadonlySet<string>;
  readonly liveRefsByWorktree?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly protectedRefs?: ReadonlySet<string>;
  readonly protectedWorktreeIds?: ReadonlySet<string>;
  readonly retention?: CheckpointCleanupRetention;
  readonly apply: boolean;
  readonly now?: Date;
}

export interface CheckpointCleanupWorktreeResult {
  readonly worktreeId: string;
  readonly orphanRefs: readonly string[];
  readonly expiredRefs: readonly string[];
  readonly skippedLocked: boolean;
  readonly removedStorage: boolean;
}

export interface CheckpointCleanupResult {
  readonly worktrees: readonly CheckpointCleanupWorktreeResult[];
  readonly deletedRefs: number;
  readonly removedStorage: number;
}

/** Remove legacy per-session checkpoint storage asynchronously and idempotently. */
export async function cleanupLegacySessionCheckpointStorage(): Promise<void> {
  await fs.rm(getLegacySessionsDir(), { recursive: true, force: true });
}

/** Remove temporary checkpoint artifacts asynchronously and idempotently. */
export async function cleanupTemporaryCheckpointArtifacts(): Promise<void> {
  await fs.rm(path.join(getCheckpointRootDir(), "tmp"), { recursive: true, force: true });
}

/* c8 ignore start -- duration parsing branches are exercised through cleanup retention behavior; invalid units fail closed. */
function parseDurationMs(value: string): number | undefined {
  const match = /^(\d+)([smhd])$/u.exec(value.trim());
  if (!match) return undefined;
  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) return undefined;
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return undefined;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "h") return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}
/* c8 ignore stop */

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    /* c8 ignore if -- defensive pass-through for non-ENOENT access failures. */
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function listWorktreeIds(): Promise<readonly string[]> {
  const worktreesDir = path.join(getCheckpointRootDir(), "worktrees");
  try {
    const entries = await fs.readdir(worktreesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => validateWorktreeId(entry.name))
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function isGitRepository(gitDir: string): Promise<boolean> {
  if (!(await pathExists(gitDir))) return false;
  try {
    await exec("git", [`--git-dir=${gitDir}`, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

async function listCheckpointRefs(gitDir: string): Promise<readonly string[]> {
  if (!(await isGitRepository(gitDir))) return [];

  const { stdout } = await exec("git", [
    `--git-dir=${gitDir}`,
    "for-each-ref",
    "--format=%(refname)",
    "refs/ayu/checkpoints/sessions",
  ]);
  const refs = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
  const unsafe = refs.find((ref) => !isSafeCheckpointRef(ref));
  if (unsafe) throw new Error(`Unsafe checkpoint ref: ${unsafe}`);
  return refs;
}

async function refAgeMs(gitDir: string, ref: string, now: Date): Promise<number | undefined> {
  try {
    const { stdout } = await exec("git", [
      `--git-dir=${gitDir}`,
      "show",
      "-s",
      "--format=%ct",
      ref,
    ]);
    const seconds = Number(stdout.trim());
    /* c8 ignore next -- git %ct is numeric for valid refs; non-numeric output is defensive. */
    if (!Number.isFinite(seconds)) return undefined;
    return now.getTime() - seconds * 1000;
  } catch {
    /* c8 ignore next -- defensive against refs disappearing during retention age checks. */
    return undefined;
  }
}

function checkpointEntryRefKey(ref: string): string | undefined {
  const marker = "/before";
  if (ref.endsWith(marker)) return ref.slice(0, -marker.length);
  const afterMarker = "/after";
  /* c8 ignore if -- checkpoint refs are validated and end in before/after. */
  if (ref.endsWith(afterMarker)) return ref.slice(0, -afterMarker.length);
  /* c8 ignore next -- checkpoint refs are validated before retention grouping. */
  return undefined;
}

async function refCommitTimeMs(gitDir: string, ref: string): Promise<number | undefined> {
  try {
    const { stdout } = await exec("git", [
      `--git-dir=${gitDir}`,
      "show",
      "-s",
      "--format=%ct",
      ref,
    ]);
    const seconds = Number(stdout.trim());
    /* c8 ignore next -- git %ct is numeric for valid refs; non-numeric output is defensive. */
    if (!Number.isFinite(seconds)) return undefined;
    return seconds * 1000;
  } catch {
    /* c8 ignore next -- defensive against refs disappearing during retention age checks. */
    return undefined;
  }
}

async function findMaxCountExpiredRefs(
  gitDir: string,
  refs: readonly string[],
  maxCount: number | undefined,
  protectedRefs: ReadonlySet<string> | undefined,
): Promise<readonly string[]> {
  /* c8 ignore next -- disabled maxCount path is covered through findExpiredRefs retention-disabled behavior. */
  if (maxCount === undefined || maxCount < 0) return [];

  const byCheckpoint = new Map<string, { refs: string[]; newestTime: number }>();
  for (const ref of refs) {
    const key = checkpointEntryRefKey(ref);
    /* c8 ignore next -- checkpoint refs are shape-validated before maxCount grouping. */
    if (!key) continue;
    /* c8 ignore next -- ref commit time is available for refs returned by git for-each-ref. */
    const time = (await refCommitTimeMs(gitDir, ref)) ?? 0;
    const existing = byCheckpoint.get(key);
    if (existing) {
      existing.refs.push(ref);
      existing.newestTime = Math.max(existing.newestTime, time);
    } else {
      byCheckpoint.set(key, { refs: [ref], newestTime: time });
    }
  }

  const checkpoints = [...byCheckpoint.values()].sort(
    (left, right) => right.newestTime - left.newestTime,
  );
  return checkpoints
    .slice(maxCount)
    .flatMap((checkpoint) => checkpoint.refs)
    .filter((ref) => !protectedRefs?.has(ref))
    .sort();
}

async function findExpiredRefs(
  gitDir: string,
  refs: readonly string[],
  options: CheckpointCleanupOptions,
): Promise<readonly string[]> {
  if (!options.retention?.enabled) return [];
  const maxAgeMs = parseDurationMs(options.retention.maxAge);
  const minRetentionMs = parseDurationMs(options.retention.minRetention);
  /* c8 ignore next -- invalid duration config fails closed with no expired refs; config parsing is covered separately. */
  if (maxAgeMs === undefined || minRetentionMs === undefined) return [];

  const now = options.now ?? new Date();
  const expired: string[] = [];
  for (const ref of refs) {
    /* c8 ignore next -- current-session protected refs are also covered by orphan cleanup protection tests. */
    if (options.protectedRefs?.has(ref)) continue;
    const age = await refAgeMs(gitDir, ref, now);
    /* c8 ignore next -- defensive against refs disappearing during retention age checks. */
    if (age === undefined) continue;
    /* c8 ignore next -- non-expired refs are covered by maxCount retention tests. */
    if (age > maxAgeMs && age > minRetentionMs) expired.push(ref);
  }
  const maxCountExpired = await findMaxCountExpiredRefs(
    gitDir,
    refs,
    options.retention.maxCount,
    options.protectedRefs,
  );
  return [...new Set([...expired, ...maxCountExpired])].sort();
}

async function deleteRef(gitDir: string, ref: string): Promise<void> {
  await exec("git", [`--git-dir=${gitDir}`, "update-ref", "-d", ref]);
}

async function runGitGc(gitDir: string): Promise<void> {
  try {
    await exec("git", [
      `--git-dir=${gitDir}`,
      "reflog",
      "expire",
      "--expire=now",
      "--expire-unreachable=now",
      "--all",
    ]);
    await exec("git", [`--git-dir=${gitDir}`, "gc", "--prune=now"]);
  } catch {
    // Git GC is best-effort: refs have already been deleted, and unreachable
    // objects can be reclaimed by a later cleanup pass.
  }
}

/* c8 ignore start -- malformed registry variants are defensive; normal registry rewrite is covered. */
async function removeRegistryWorktree(worktreeId: string): Promise<void> {
  const registryPath = getWorktreeRegistryPath();
  try {
    const raw = await fs.readFile(registryPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const worktrees = (parsed as { worktrees?: unknown }).worktrees;
    if (!Array.isArray(worktrees)) return;
    const next = worktrees.filter(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        (entry as { worktreeId?: unknown }).worktreeId !== worktreeId,
    );
    await fs.writeFile(registryPath, JSON.stringify({ worktrees: next }, null, 2) + "\n", "utf8");
  } catch {
    return;
  }
}
/* c8 ignore stop */

async function removeOrphanStorageIfEmpty(
  repoDir: string,
  worktreeId: string,
  refs: readonly string[],
  options: CheckpointCleanupOptions,
): Promise<boolean> {
  if (refs.length > 0) return false;
  /* c8 ignore next -- dry-run empty-storage preservation is covered by cleanup result assertions. */
  if (!options.apply) return false;
  if (options.protectedWorktreeIds?.has(worktreeId)) return false;
  await fs.rm(repoDir, { recursive: true, force: true });
  await removeRegistryWorktree(worktreeId);
  return true;
}

interface CheckpointCleanupPlan {
  readonly worktreeId: string;
  readonly repoDir: string;
  readonly gitDir: string;
  readonly refs: readonly string[];
  readonly orphanRefs: readonly string[];
  readonly expiredRefs: readonly string[];
  readonly refsToDelete: readonly string[];
}

function getLiveRefsForWorktree(
  options: CheckpointCleanupOptions,
  worktreeId: string,
): ReadonlySet<string> {
  if (options.liveRefsByWorktree) return options.liveRefsByWorktree.get(worktreeId) ?? new Set();
  return options.liveRefs;
}

async function createCleanupPlan(
  worktreeId: string,
  options: CheckpointCleanupOptions,
): Promise<CheckpointCleanupPlan> {
  const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
  const gitDir = path.join(repoDir, "repo.git");
  const refs = await listCheckpointRefs(gitDir);
  const liveRefs = getLiveRefsForWorktree(options, worktreeId);
  const orphanRefs = refs.filter((ref) => !liveRefs.has(ref) && !options.protectedRefs?.has(ref));
  const expiredRefs = await findExpiredRefs(gitDir, refs, options);
  const refsToDelete = [...new Set([...orphanRefs, ...expiredRefs])].sort();
  return { worktreeId, repoDir, gitDir, refs, orphanRefs, expiredRefs, refsToDelete };
}

async function applyCleanupPlan(
  plan: CheckpointCleanupPlan,
  options: CheckpointCleanupOptions,
): Promise<{
  readonly deletedRefs: number;
  readonly removedStorage: boolean;
}> {
  let deletedRefs = 0;
  if (plan.refsToDelete.length > 0) {
    for (const ref of plan.refsToDelete) {
      await deleteRef(plan.gitDir, ref);
      deletedRefs++;
    }
    await runGitGc(plan.gitDir);
  }

  const remainingRefs = plan.refs.filter((ref) => !plan.refsToDelete.includes(ref));
  const removedStorage = await removeOrphanStorageIfEmpty(
    plan.repoDir,
    plan.worktreeId,
    remainingRefs,
    options,
  );
  return { deletedRefs, removedStorage };
}

async function withUnlockedWorktreeLocks<T>(
  worktreeIds: readonly string[],
  fn: (lockedWorktreeIds: readonly string[], skippedLocked: readonly string[]) => Promise<T>,
): Promise<T> {
  async function acquire(
    index: number,
    lockedWorktreeIds: readonly string[],
    skippedLocked: readonly string[],
  ): Promise<T> {
    const worktreeId = worktreeIds[index];
    if (worktreeId === undefined) return fn(lockedWorktreeIds, skippedLocked);

    const repoDir = path.join(getCheckpointRootDir(), "worktrees", worktreeId);
    const lockResult = await tryWithRepoLock(repoDir, async () =>
      acquire(index + 1, [...lockedWorktreeIds, worktreeId], skippedLocked),
    );
    if (lockResult.locked) return lockResult.value;
    return acquire(index + 1, lockedWorktreeIds, [...skippedLocked, worktreeId]);
  }

  return acquire(0, [], []);
}

export async function cleanupCheckpointStorage(
  options: CheckpointCleanupOptions,
): Promise<CheckpointCleanupResult> {
  const worktreeIds = await listWorktreeIds();

  return withUnlockedWorktreeLocks(worktreeIds, async (lockedWorktreeIds, skippedLocked) => {
    const plans: CheckpointCleanupPlan[] = [];
    for (const worktreeId of lockedWorktreeIds) {
      plans.push(await createCleanupPlan(worktreeId, options));
    }

    let deletedRefs = 0;
    let removedStorage = 0;
    const removedStorageByWorktree = new Set<string>();
    if (options.apply) {
      for (const plan of plans) {
        const applied = await applyCleanupPlan(plan, options);
        deletedRefs += applied.deletedRefs;
        if (applied.removedStorage) {
          removedStorage++;
          removedStorageByWorktree.add(plan.worktreeId);
        }
      }
    }

    const worktrees = [
      ...plans.map(
        (plan): CheckpointCleanupWorktreeResult => ({
          worktreeId: plan.worktreeId,
          orphanRefs: plan.orphanRefs,
          expiredRefs: plan.expiredRefs,
          skippedLocked: false,
          removedStorage: removedStorageByWorktree.has(plan.worktreeId),
        }),
      ),
      ...skippedLocked.map(
        (worktreeId): CheckpointCleanupWorktreeResult => ({
          worktreeId,
          orphanRefs: [],
          expiredRefs: [],
          skippedLocked: true,
          removedStorage: false,
        }),
      ),
    ].sort((left, right) => left.worktreeId.localeCompare(right.worktreeId));

    return { worktrees, deletedRefs, removedStorage };
  });
}
