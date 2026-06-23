import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import {
  deleteSessionCheckpointStorage,
  getRepoDir,
  listCheckpointStorageManifests,
  purgeSessionCheckpointStorage,
  readCheckpointStorageManifest,
  writeCheckpointStorageManifest,
} from "@ayulab/pi-checkpoint";
import path from "node:path";
import { access } from "node:fs/promises";
import {
  CheckpointSelectorComponent,
  type CheckpointSelectorSession,
  type SessionListProgress,
} from "./checkpoint-selector";

function normalizeComparablePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeTitle(input: string | undefined): string {
  const collapsed = input?.replace(/\s+/g, " ").trim() ?? "";
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

function isEmptyUntitledLiveSession(session: SessionInfo): boolean {
  return (
    !session.name &&
    session.messageCount === 0 &&
    normalizeTitle(session.firstMessage) === "Untitled session"
  );
}

function isEmptyUntitledManifest(firstUserMessage: string): boolean {
  return normalizeTitle(firstUserMessage) === "Untitled session";
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function syncLiveSessionManifest(session: SessionInfo): Promise<void> {
  if (isEmptyUntitledLiveSession(session)) return;

  const repoDir = getRepoDir(session.path);
  if (!(await fileExists(path.join(repoDir, ".git")))) return;

  const existing = await readCheckpointStorageManifest(repoDir);
  const now = new Date().toISOString();
  await writeCheckpointStorageManifest(repoDir, {
    version: 1,
    sessionId: session.id,
    sessionFile: session.path,
    cwd: session.cwd,
    firstUserMessage: normalizeTitle(session.name ?? session.firstMessage),
    createdAt: existing?.createdAt ?? session.created.toISOString(),
    updatedAt: session.modified.toISOString() || now,
  });
}

function resolveLiveSessionDisplayPath(
  sessionPath: string,
  repoDirBySessionFile: ReadonlyMap<string, string>,
): string {
  return repoDirBySessionFile.get(normalizeComparablePath(sessionPath)) ?? sessionPath;
}

async function buildCheckpointSessions(
  cwd: string,
  scope: "current" | "all",
  onProgress?: SessionListProgress,
): Promise<CheckpointSelectorSession[]> {
  const liveSessions = (
    scope === "current"
      ? await SessionManager.list(cwd, undefined, onProgress)
      : await SessionManager.listAll(onProgress)
  ).filter((session) => !isEmptyUntitledLiveSession(session));

  for (const session of liveSessions) {
    await syncLiveSessionManifest(session);
  }

  const manifests = await listCheckpointStorageManifests();
  const normalizedCwd = normalizeComparablePath(cwd);
  const repoDirBySessionFile = new Map<string, string>();

  for (const session of liveSessions) {
    const repoDir = getRepoDir(session.path);
    if (await fileExists(path.join(repoDir, ".git"))) {
      repoDirBySessionFile.set(normalizeComparablePath(session.path), repoDir);
    }
  }

  const sessions: CheckpointSelectorSession[] = [];
  const seenRepoDirs = new Set<string>();
  const liveNoCheckpointSessionIds = new Set<string>();
  const liveNoCheckpointSessionFiles = new Set<string>();

  for (const session of liveSessions) {
    const repoDir = repoDirBySessionFile.get(normalizeComparablePath(session.path));
    const parentSessionDisplayPath = session.parentSessionPath
      ? resolveLiveSessionDisplayPath(session.parentSessionPath, repoDirBySessionFile)
      : undefined;

    if (repoDir) {
      seenRepoDirs.add(normalizeComparablePath(repoDir));
      sessions.push({
        ...session,
        path: repoDir,
        ...(parentSessionDisplayPath ? { parentSessionPath: parentSessionDisplayPath } : {}),
        checkpointRepoDir: repoDir,
        sourceSessionFile: session.path,
      });
      continue;
    }

    if (scope === "all") {
      liveNoCheckpointSessionIds.add(session.id);
      liveNoCheckpointSessionFiles.add(normalizeComparablePath(session.path));
      const baseTitle = normalizeTitle(session.name ?? session.firstMessage);
      sessions.push({
        ...session,
        path: session.path,
        ...(parentSessionDisplayPath ? { parentSessionPath: parentSessionDisplayPath } : {}),
        ...(session.name ? { name: normalizeTitle(session.name) } : {}),
        firstMessage: session.name ? normalizeTitle(session.firstMessage) : baseTitle,
        allMessagesText: `${baseTitle} no checkpoints session without checkpoint history ${session.cwd}`,
        checkpointRepoDir: undefined,
        sourceSessionFile: session.path,
        checkpointStatus: "no checkpoints",
      });
    }
  }

  for (const record of manifests) {
    if (scope === "current" && normalizeComparablePath(record.manifest.cwd) !== normalizedCwd) {
      continue;
    }

    const repoDirKey = normalizeComparablePath(record.repoDir);
    if (seenRepoDirs.has(repoDirKey)) continue;
    if (isEmptyUntitledManifest(record.manifest.firstUserMessage)) continue;
    if (liveNoCheckpointSessionIds.has(record.manifest.sessionId)) continue;
    if (liveNoCheckpointSessionFiles.has(normalizeComparablePath(record.manifest.sessionFile))) {
      continue;
    }

    const orphanTitle = normalizeTitle(record.manifest.firstUserMessage);
    sessions.push({
      path: record.repoDir,
      id: record.manifest.sessionId,
      cwd: record.manifest.cwd,
      created: toDate(record.manifest.createdAt),
      modified: toDate(record.modifiedAt),
      messageCount: 0,
      firstMessage: orphanTitle,
      allMessagesText: `${orphanTitle} checkpoint storage without a matching session ${record.manifest.cwd}`,
      checkpointRepoDir: record.repoDir,
      sourceSessionFile: undefined,
      checkpointStatus: "no session",
    });
  }

  return sessions;
}

async function deleteCheckpointStorage(
  selected: CheckpointSelectorSession,
  activeSessionFile: string | undefined,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  if (!selected.checkpointRepoDir) {
    return { ok: false, message: "This session has no checkpoint storage to delete" };
  }

  const result =
    selected.checkpointStatus === "no session"
      ? await purgeSessionCheckpointStorage(selected.checkpointRepoDir, activeSessionFile)
      : await deleteSessionCheckpointStorage(selected.checkpointRepoDir, activeSessionFile);

  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

async function openCheckpointSelector(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.ui.custom) {
    const sessions = await buildCheckpointSessions(ctx.cwd, "current");
    await ctx.ui.select(
      "Checkpoint Storage:",
      sessions.map((session) => session.name ?? session.firstMessage),
    );
    return;
  }

  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const currentRepoDir = getRepoDir(currentSessionFile);
  const currentSelectorPath =
    currentSessionFile && (await fileExists(path.join(currentRepoDir, ".git")))
      ? currentRepoDir
      : (currentSessionFile ?? currentRepoDir);

  await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
    const selector = new CheckpointSelectorComponent({
      currentLoader: (onProgress?: SessionListProgress) =>
        buildCheckpointSessions(ctx.cwd, "current", onProgress),
      allLoader: (onProgress?: SessionListProgress) =>
        buildCheckpointSessions(ctx.cwd, "all", onProgress),
      deleteStorage: (session) =>
        deleteCheckpointStorage(session, ctx.sessionManager.getSessionFile()),
      currentSessionPath: currentSelectorPath,
      requestRender: () => tui.requestRender(),
      onClose: () => done(undefined),
      theme,
      keybindings,
    });

    return selector;
  });
}

export function registerCheckpointStorageCommand(pi: ExtensionAPI): void {
  pi.registerCommand("checkpoint", {
    description: "Manage checkpoint storage for the current directory",
    handler: async (_args, ctx) => {
      await openCheckpointSelector(ctx);
    },
  });
}

export const __checkpointCommandTestOnly = {
  normalizeComparablePath,
  normalizeTitle,
  toDate,
  buildCheckpointSessions,
  deleteCheckpointStorage,
  syncLiveSessionManifest,
};
