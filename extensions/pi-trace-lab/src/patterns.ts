/**
 * PatternCluster — Aggregate session reviews into recurring patterns.
 *
 * Algorithm:
 * 1. Group reviews by (failure_layer, normalized harness_improvement text).
 * 2. Count frequency; only surfaces groups with ≥2 occurrences.
 * 3. Merge into existing patterns or create new ones.
 * 4. Present to user via TUI for confirmation / naming / status update.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Pattern, SessionReview, FailureLayer } from "@ayulab/pi-trace-engine";

const FREQUENCY_THRESHOLD = 2;

interface RawPattern {
  layer: FailureLayer;
  idea: string;
  sessions: string[];
}

/**
 * Cluster reviews from a time range into patterns.
 * Returns new/updated patterns (not yet persisted).
 */
export async function clusterPatterns(
  reviews: SessionReview[],
  existingPatterns: Pattern[],
): Promise<{ patterns: Pattern[]; report: string }> {
  // 1. Group by (layer + normalized idea)
  const groups = new Map<string, RawPattern>();

  for (const review of reviews) {
    if (!review.shouldIterate || !review.iterationIdea) continue;

    const key = `${review.failureLayer ?? "general"}|${normalizeIdea(review.iterationIdea)}`;
    const existing = groups.get(key);

    if (existing) {
      if (!existing.sessions.includes(review.sessionId)) {
        existing.sessions.push(review.sessionId);
      }
    } else {
      groups.set(key, {
        layer: review.failureLayer,
        idea: review.iterationIdea,
        sessions: [review.sessionId],
      });
    }
  }

  // 2. Filter by frequency threshold
  const frequent = Array.from(groups.values()).filter(
    (g) => g.sessions.length >= FREQUENCY_THRESHOLD,
  );

  // 3. Merge with existing patterns
  const patterns: Pattern[] = [...existingPatterns];
  const now = new Date().toISOString();

  for (const raw of frequent) {
    const existing = findMatchingPattern(patterns, raw);

    if (existing) {
      // Update frequency and sessions
      const newSessions = raw.sessions.filter((s) => !existing.sourceSessions.includes(s));
      existing.sourceSessions.push(...newSessions);
      existing.frequency = existing.sourceSessions.length;
      existing.updatedAt = now;
    } else {
      patterns.push({
        id: generatePatternId(raw),
        name: raw.idea.slice(0, 60),
        description: raw.idea,
        harnessLayer: raw.layer ?? "general",
        frequency: raw.sessions.length,
        sourceSessions: [...raw.sessions],
        status: "observed",
        iterationCardPath: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 4. Build report
  const reportLines = [
    `# Trace Lab Weekly Pattern Report`,
    ``,
    `Generated: ${now}`,
    `Reviews analyzed: ${reviews.length}`,
    `Patterns found: ${frequent.length}`,
    ``,
  ];

  for (const p of patterns.filter((p) => p.frequency >= FREQUENCY_THRESHOLD)) {
    reportLines.push(`## ${p.name}`);
    reportLines.push(`- **Layer**: ${p.harnessLayer}`);
    reportLines.push(`- **Frequency**: ${p.frequency}`);
    reportLines.push(`- **Status**: ${p.status}`);
    reportLines.push(`- **Sessions**: ${p.sourceSessions.join(", ")}`);
    reportLines.push(`- **Description**: ${p.description}`);
    reportLines.push(``);
  }

  return { patterns, report: reportLines.join("\n") };
}

/**
 * Interactive TUI to confirm/edit clustered patterns.
 */
export async function confirmPatterns(
  ctx: ExtensionContext,
  patterns: Pattern[],
): Promise<Pattern[]> {
  if (!ctx.hasUI) return patterns;

  const toConfirm = patterns.filter(
    (p) => p.status === "observed" && p.frequency >= FREQUENCY_THRESHOLD,
  );
  if (toConfirm.length === 0) {
    ctx.ui.notify("Trace Lab: No new patterns to confirm this week.", "info");
    return patterns;
  }

  const confirmed: Pattern[] = [];

  for (const pattern of toConfirm) {
    const decision = await askPatternConfirm(ctx, pattern);

    if (decision === "keep") {
      pattern.status = "drafting";
      confirmed.push(pattern);
    } else if (decision === "edit") {
      const newName = await askPatternName(ctx, pattern);
      if (newName) {
        pattern.name = newName;
        pattern.status = "drafting";
        confirmed.push(pattern);
      }
    }
    // "skip" → leave as observed
  }

  ctx.ui.notify(
    `Trace Lab: ${confirmed.length} pattern(s) confirmed for iteration drafting.`,
    "info",
  );
  return patterns;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeIdea(idea: string): string {
  return idea
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function findMatchingPattern(patterns: Pattern[], raw: RawPattern): Pattern | undefined {
  return patterns.find((p) => {
    if (p.harnessLayer !== (raw.layer ?? "general")) return false;
    const normalizedExisting = normalizeIdea(p.description);
    const normalizedNew = normalizeIdea(raw.idea);
    // Fuzzy match: same normalized text or high overlap
    return (
      normalizedExisting === normalizedNew ||
      levenshteinRatio(normalizedExisting, normalizedNew) > 0.7
    );
  });
}

function generatePatternId(raw: RawPattern): string {
  const hash = raw.idea
    .split("")
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
    .toString(36)
    .slice(-6);
  return `${raw.layer ?? "general"}-${hash}`;
}

function levenshteinRatio(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];

  const firstRow = matrix[0]!;
  for (let j = 0; j <= a.length; j++) firstRow[j] = j;

  for (let i = 1; i <= b.length; i++) {
    const prevRow = matrix[i - 1]!;
    const currRow = matrix[i]!;
    for (let j = 1; j <= a.length; j++) {
      currRow[j] =
        b[i - 1] === a[j - 1]
          ? prevRow[j - 1]!
          : Math.min(prevRow[j - 1]! + 1, currRow[j - 1]! + 1, prevRow[j]! + 1);
    }
  }

  const distance = matrix[b.length]![a.length]!;
  return 1 - distance / Math.max(a.length, b.length);
}

// ─── TUI: Pattern Confirm ───────────────────────────────────────────────────

async function askPatternConfirm(
  ctx: ExtensionContext,
  pattern: Pattern,
): Promise<"keep" | "edit" | "skip"> {
  const options = [
    { value: "keep", label: "✅ 确认 — 保持名称，进入 drafting" },
    { value: "edit", label: "✏️ 编辑 — 改名后进入 drafting" },
    { value: "skip", label: "⏭️ 跳过 — 保持 observed" },
  ];

  return ctx.ui.custom<"keep" | "edit" | "skip">(
    (tui, theme, _kb, done) => {
      let selected = 0;
      let cached: string[] | undefined;

      function refresh(): void {
        cached = undefined;
        tui.requestRender();
      }

      function render(width: number): string[] {
        if (cached) return cached;

        const lines: string[] = [];
        const bar = theme.fg("accent", "─".repeat(Math.max(1, width)));
        lines.push(bar);
        lines.push(`${theme.fg("accent", "◇")} ${theme.fg("text", "确认 Pattern")}`);
        lines.push(``);
        lines.push(`│ ${theme.fg("muted", "名称:")} ${pattern.name}`);
        lines.push(`│ ${theme.fg("muted", "层:")} ${pattern.harnessLayer}`);
        lines.push(`│ ${theme.fg("muted", "频次:")} ${pattern.frequency} 次`);
        lines.push(`│ ${theme.fg("muted", "描述:")} ${pattern.description.slice(0, 80)}`);
        lines.push(``);

        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (!opt) continue;
          const prefix = i === selected ? theme.fg("accent", "❯ ") : "  ";
          const label =
            i === selected ? theme.fg("accent", opt.label) : theme.fg("text", opt.label);
          lines.push(`│ ${prefix}${label}`);
        }

        lines.push(``);
        lines.push(theme.fg("dim", "↑↓ navigate • Enter select"));
        lines.push(bar);

        cached = lines;
        return lines;
      }

      return {
        get focused() {
          return true;
        },
        set focused(_v) {},
        render,
        invalidate() {
          cached = undefined;
        },
        handleInput(data: string) {
          if (matchesKey(data, Key.up)) {
            selected = (selected - 1 + options.length) % options.length;
            refresh();
          }
          if (matchesKey(data, Key.down)) {
            selected = (selected + 1) % options.length;
            refresh();
          }
          if (matchesKey(data, Key.enter)) {
            const selectedOption = options[selected];
            if (selectedOption) done(selectedOption.value as "keep" | "edit" | "skip");
          }
        },
      };
    },
    { overlay: true, overlayOptions: { width: "70%", minWidth: 50, maxHeight: "60%", margin: 1 } },
  );
}

async function askPatternName(ctx: ExtensionContext, pattern: Pattern): Promise<string | null> {
  return ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      let text = pattern.name;
      let cached: string[] | undefined;

      function refresh(): void {
        cached = undefined;
        tui.requestRender();
      }

      function render(width: number): string[] {
        if (cached) return cached;
        const lines: string[] = [];
        const bar = theme.fg("accent", "─".repeat(Math.max(1, width)));
        lines.push(bar);
        lines.push(`${theme.fg("accent", "◇")} ${theme.fg("text", "编辑 Pattern 名称")}`);
        lines.push(``);
        lines.push(`│ ${text || theme.fg("dim", "(type name…)")}`);
        lines.push(``);
        lines.push(theme.fg("dim", "Enter submit • Esc cancel"));
        lines.push(bar);
        cached = lines;
        return lines;
      }

      return {
        get focused() {
          return true;
        },
        set focused(_v) {},
        render,
        invalidate() {
          cached = undefined;
        },
        handleInput(data: string) {
          if (matchesKey(data, Key.escape)) {
            done(null);
            return;
          }
          if (matchesKey(data, Key.enter)) {
            done(text.trim() || null);
            return;
          }
          if (matchesKey(data, Key.backspace)) {
            text = text.slice(0, -1);
            refresh();
            return;
          }
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            text += data;
            refresh();
          }
        },
      };
    },
    { overlay: true, overlayOptions: { width: "70%", minWidth: 50, maxHeight: "40%", margin: 1 } },
  );
}
