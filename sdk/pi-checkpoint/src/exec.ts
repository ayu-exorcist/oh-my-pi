import { spawn } from "node:child_process";

const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const KILL_AFTER_TIMEOUT_MS = 5_000;

/**
 * Git environment variables required by {@link RepoManager}.
 */
export interface ExecEnv {
  GIT_DIR: string;
  GIT_WORK_TREE: string;
  GIT_INDEX_FILE: string;
}

export interface ExecOptions {
  readonly timeoutMs?: number;
  readonly input?: string;
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

/**
 * Discriminated union representing the outcome of a command.
 *
 * Using a union instead of throwing lets callers handle errors
 * explicitly at the type level (skill: discriminated unions).
 *
 * @example
 * const result = await execSafe('git', ['status']);
 * if (!result.ok) {
 *   console.error(result.error);
 *   return;
 * }
 * console.log(result.value.stdout);
 */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Successful wrapper helper. */
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Failure wrapper helper. */
function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Run a shell command and return its stdout/stderr.
 *
 * Rejects on non-zero exit code or spawn failure.
 */
export async function exec(
  command: string,
  args: string[],
  env?: ExecEnv,
  cwd?: string,
  options: ExecOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      const killTimeout = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_TIMEOUT_MS);
      killTimeout.unref?.();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${formatCommand(command, args)}`));
    }, timeoutMs);

    function settle<T>(fn: (value: T) => void, value: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        settle(reject, new Error(stderr || `Command failed with exit code ${code}`));
      } else {
        settle(resolve, { stdout, stderr });
      }
    });

    child.on("error", (spawnErr) => {
      settle(reject, spawnErr);
    });
  });
}

/**
 * Variant of {@link exec} that never throws.
 *
 * Returns a {@link Result} so failure paths are visible to the type checker.
 */
export async function execSafe(
  command: string,
  args: string[],
  env?: ExecEnv,
  cwd?: string,
  options: ExecOptions = {},
): Promise<Result<{ stdout: string; stderr: string }>> {
  try {
    const output = await exec(command, args, env, cwd, options);
    return ok(output);
  } catch (e) {
    return err(String(e));
  }
}
