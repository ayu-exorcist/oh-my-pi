/**
 * StorageManager — File-based persistence for traces, reviews, patterns, and iterations.
 *
 * Default layout (under ~/.pi/agent/ayu/trace-lab/<project-key>/):
 *   sessions/<session-id>.json
 *   reviews/<session-id>.md
 *   patterns/patterns.json
 *   iterations/ITER-<pattern-id>.md
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { SessionTrace, SessionReview, Pattern, FailureLayer } from "./types";

function resolveTraceLabDir(cwd: string): string {
  const base = path.basename(cwd) || "unknown";
  const hash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return path.join(os.homedir(), ".pi", "agent", "ayu", "trace-lab", `${base}-${hash}`);
}

export class StorageManager {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = resolveTraceLabDir(cwd);
  }

  async ensureDirs(): Promise<void> {
    await mkdir(path.join(this.baseDir, "sessions"), { recursive: true });
    await mkdir(path.join(this.baseDir, "reviews"), { recursive: true });
    await mkdir(path.join(this.baseDir, "patterns"), { recursive: true });
    await mkdir(path.join(this.baseDir, "iterations"), { recursive: true });
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async saveSessionTrace(trace: SessionTrace): Promise<void> {
    const filePath = path.join(this.baseDir, "sessions", `${trace.sessionId}.json`);
    await writeFile(filePath, JSON.stringify(trace, null, 2), "utf8");
  }

  async loadSessionTrace(sessionId: string): Promise<SessionTrace | null> {
    try {
      const filePath = path.join(this.baseDir, "sessions", `${sessionId}.json`);
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return isSessionTrace(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async listSessionTraces(since?: Date): Promise<SessionTrace[]> {
    const dir = path.join(this.baseDir, "sessions");
    const files = await readdir(dir).catch((): string[] => []);
    const traces: SessionTrace[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await readFile(path.join(dir, file), "utf8");
        const trace = JSON.parse(content) as unknown;
        if (!isSessionTrace(trace)) continue;
        if (!since || trace.startTime >= since.getTime()) {
          traces.push(trace);
        }
      } catch {
        // skip corrupt files
      }
    }

    return traces.sort((a, b) => b.startTime - a.startTime);
  }

  // ─── Reviews ──────────────────────────────────────────────────────────────

  async saveReview(review: SessionReview): Promise<void> {
    const filePath = path.join(this.baseDir, "reviews", `${review.sessionId}.md`);
    await writeFile(filePath, renderReviewMarkdown(review), "utf8");
  }

  async loadReview(sessionId: string): Promise<SessionReview | null> {
    try {
      const filePath = path.join(this.baseDir, "reviews", `${sessionId}.md`);
      const content = await readFile(filePath, "utf8");
      return parseReviewMarkdown(content, sessionId);
    } catch {
      return null;
    }
  }

  async loadAllReviews(): Promise<SessionReview[]> {
    const dir = path.join(this.baseDir, "reviews");
    const files = await readdir(dir).catch((): string[] => []);
    const reviews: SessionReview[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const sessionId = file.replace(/\.md$/, "");
      try {
        const content = await readFile(path.join(dir, file), "utf8");
        const review = parseReviewMarkdown(content, sessionId);
        if (review) reviews.push(review);
      } catch {
        // skip
      }
    }

    return reviews;
  }

  // ─── Patterns ─────────────────────────────────────────────────────────────

  async loadPatterns(): Promise<Pattern[]> {
    const filePath = path.join(this.baseDir, "patterns", "patterns.json");
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isPattern) : [];
    } catch {
      return [];
    }
  }

  async savePatterns(patterns: Pattern[]): Promise<void> {
    const filePath = path.join(this.baseDir, "patterns", "patterns.json");
    await writeFile(filePath, JSON.stringify(patterns, null, 2), "utf8");
  }

  // ─── Iteration Cards ──────────────────────────────────────────────────────

  async saveIterationCard(patternId: string, content: string): Promise<string> {
    const filePath = path.join(this.baseDir, "iterations", `ITER-${patternId}.md`);
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  async loadIterationCard(patternId: string): Promise<string | null> {
    try {
      const filePath = path.join(this.baseDir, "iterations", `ITER-${patternId}.md`);
      return await readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }
}

// ─── Markdown Serialization ─────────────────────────────────────────────────

function renderReviewMarkdown(review: SessionReview): string {
  return `---
session_id: ${review.sessionId}
reviewed_at: ${review.reviewedAt}
outcome: ${review.outcome}
failure_layer: ${review.failureLayer ?? "null"}
should_iterate: ${review.shouldIterate}
---

# Session Review: ${review.sessionId}

## Outcome
${review.outcome}

## Failure Layer
${review.failureLayer ?? "N/A"}

## Harness Improvement
${review.harnessImprovement ?? "N/A"}

## Should Iterate
${review.shouldIterate ? "Yes" : "No"}

## Iteration Idea
${review.iterationIdea ?? "N/A"}

## Reviewer Notes
${review.reviewerNotes}
`;
}

function parseReviewMarkdown(content: string, fallbackSessionId: string): SessionReview | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1]!;
  const body = content.slice(fmMatch[0].length).trim();

  const getFm = (key: string): string | null => {
    const match = fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return match?.[1]?.trim() ?? null;
  };

  const extractBodySection = (heading: string): string | null => {
    const pattern = new RegExp(`##\\s+${heading}\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
    const match = body.match(pattern);
    const raw = match?.[1]?.trim() ?? null;
    return raw === "N/A" ? null : raw;
  };

  const outcome = getFm("outcome");
  return {
    sessionId: getFm("session_id") ?? fallbackSessionId,
    reviewedAt: getFm("reviewed_at") ?? new Date().toISOString(),
    outcome: isReviewOutcome(outcome) ? outcome : "success",
    failureLayer: parseFailureLayer(getFm("failure_layer")),
    harnessImprovement: extractBodySection("Harness Improvement"),
    shouldIterate: getFm("should_iterate") === "true",
    iterationIdea: extractBodySection("Iteration Idea"),
    reviewerNotes: extractBodySection("Reviewer Notes") ?? body,
  };
}

export function isReviewOutcome(value: unknown): value is SessionReview["outcome"] {
  return value === "success" || value === "partial" || value === "failure";
}

export function isFailureLayer(value: unknown): value is FailureLayer {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  return [
    "environment_contract",
    "procedural_skill",
    "action_realization",
    "trajectory_regulation",
    "observation",
  ].includes(value);
}

export function parseFailureLayer(raw: string | null): SessionReview["failureLayer"] {
  if (!raw || raw === "null") return null;
  return isFailureLayer(raw) ? raw : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSessionTrace(value: unknown): value is SessionTrace {
  return (
    isRecord(value) && typeof value.sessionId === "string" && typeof value.startTime === "number"
  );
}

export function isPattern(value: unknown): value is Pattern {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}
