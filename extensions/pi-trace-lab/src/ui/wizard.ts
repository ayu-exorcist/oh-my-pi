/**
 * ReviewWizard — Multi-step TUI overlay for structured session review.
 *
 * Uses ctx.ui.custom() for each step.  Each step is a standalone overlay
 * with ↑↓ navigation (select) or text input (text).
 *
 * References pi-clarify pattern for custom overlay rendering.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WizardQuestion } from "@ayulab/pi-trace-engine";

export interface WizardResult {
  [key: string]: string | null | undefined;
}

/**
 * Run a multi-step wizard.  Each question becomes one overlay.
 * Returns a map of question key → answer (null if skipped).
 */
export async function runWizard(
  ctx: ExtensionContext,
  questions: WizardQuestion[],
): Promise<WizardResult> {
  const result: WizardResult = {};

  for (const q of questions) {
    const answer = await askSingleQuestion(ctx, q);
    result[q.key] = answer;
  }

  return result;
}

async function askSingleQuestion(ctx: ExtensionContext, q: WizardQuestion): Promise<string | null> {
  if (!ctx.hasUI) return null;

  if (q.type === "select") {
    return askSelect(ctx, q);
  }

  return askText(ctx, q);
}

// ─── Select Question ────────────────────────────────────────────────────────

async function askSelect(ctx: ExtensionContext, q: WizardQuestion): Promise<string | null> {
  const options = q.options ?? [];

  return ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      let selected = 0;
      let cached: string[] | undefined;

      function refresh(): void {
        cached = undefined;
        tui.requestRender();
      }

      function move(delta: number): void {
        if (options.length === 0) return;
        selected = (selected + delta + options.length) % options.length;
        refresh();
      }

      function render(width: number): string[] {
        if (cached) return cached;

        const lines: string[] = [];
        const bar = theme.fg("accent", "─".repeat(Math.max(1, width)));
        lines.push(bar);
        lines.push(`${theme.fg("accent", "◇")} ${theme.fg("text", q.message)}`);
        lines.push("");

        for (let i = 0; i < options.length; i++) {
          const opt = options[i];
          if (!opt) continue;
          const prefix = i === selected ? theme.fg("accent", "❯ ") : "  ";
          const label =
            i === selected ? theme.fg("accent", opt.label) : theme.fg("text", opt.label);
          lines.push(`│ ${prefix}${label}`);
        }

        lines.push("");
        lines.push(theme.fg("dim", "↑↓ navigate • Enter select • Esc skip"));
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
            move(-1);
            return;
          }
          if (matchesKey(data, Key.down)) {
            move(1);
            return;
          }
          if (matchesKey(data, Key.enter)) {
            done(options[selected]?.value ?? null);
            return;
          }
          if (matchesKey(data, Key.escape)) {
            done(null);
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "70%",
        minWidth: 50,
        maxHeight: "60%",
        margin: 1,
      },
    },
  );
}

// ─── Text Question ──────────────────────────────────────────────────────────

async function askText(ctx: ExtensionContext, q: WizardQuestion): Promise<string | null> {
  return ctx.ui.custom<string | null>(
    (tui, theme, _kb, done) => {
      let text = q.defaultValue ?? "";
      let cached: string[] | undefined;
      let cursor = text.length;

      function refresh(): void {
        cached = undefined;
        tui.requestRender();
      }

      function render(width: number): string[] {
        if (cached) return cached;

        const lines: string[] = [];
        const bar = theme.fg("accent", "─".repeat(Math.max(1, width)));
        lines.push(bar);
        lines.push(`${theme.fg("accent", "◇")} ${theme.fg("text", q.message)}`);
        lines.push("");

        // Input line
        const display = text || theme.fg("dim", "(type your answer…)");
        lines.push(`│ ${display}`);

        lines.push("");
        lines.push(theme.fg("dim", "Enter submit • Esc skip"));
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
            if (cursor > 0) {
              text = text.slice(0, cursor - 1) + text.slice(cursor);
              cursor -= 1;
              refresh();
            }
            return;
          }
          if (data.length === 1 && data.charCodeAt(0) >= 32) {
            text = text.slice(0, cursor) + data + text.slice(cursor);
            cursor += 1;
            refresh();
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "70%",
        minWidth: 50,
        maxHeight: "40%",
        margin: 1,
      },
    },
  );
}
