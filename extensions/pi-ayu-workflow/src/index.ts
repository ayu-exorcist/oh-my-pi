import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getLockedToolBlockReason } from "./gate";
import { loadPrompt } from "./prompts";
import {
  buildHelpText,
  setWriteEnabled,
  setWriteStatus,
  toggleWriteMode,
  WriteModeEditor,
} from "./ui";
import type { AyuState } from "./ui";

export function buildWriteModeOffPrompt(): string {
  return `Ayu Write Mode is Off for this session.

Ayu mode semantics:
- Write Mode Off is discussion, planning, review, and read-only inspection mode.
- Do not modify files, dependencies, configuration, package metadata, lockfiles, generated artifacts, git history, issues, releases, or any other persistent project state.
- Do not call write/edit or other mutating tools.
- Do not run mutating shell commands, dependency installs, code generators, formatters, cleanup commands, commits, tags, pushes, publishes, or releases.
- You may inspect read-only context when useful.
- For implementation requests, produce a plan instead of changing files:
  - clarify missing requirements;
  - summarize the goal and non-goals;
  - list files likely to change;
  - call out risks and compatibility concerns;
  - define acceptance criteria and verification plan.
- For bugs, use the Ayu diagnosis shape before proposing fixes: reproduce → minimise → hypothesise → failing test/repro → fix plan → regression verification.
- Ask the user to enable Write Mode with /ayu on <prompt> or Alt+S before implementation.`;
}

export function buildWriteModeOnPrompt(): string {
  return `Ayu Write Mode is On for this session.

Ayu mode semantics:
- Write Mode On is implementation mode for small, verified changes.
- Treat the current user request as the source of truth.
- Previous turns are background only, not implicit task parameters.
- Do not reuse prior file contents, filenames, commands, config values, or decisions unless the current request explicitly refers to them.
- Read the project AGENTS.md and only the relevant README, docs, and code before editing when needed.
- Implement the smallest vertical slice that satisfies the request.
- Do not make unrelated refactors, formatting churn, dependency changes, generated-file updates, or cleanup.
- If required information is missing for a file mutation, command, dependency change, release, deletion, overwrite, or append operation, ask before acting.
- You may use write/edit/bash as needed while Write Mode is On.
- Verify with exact commands and report evidence; if verification cannot run, explain why and list residual risk.
- Do not commit, tag, push, publish, or release unless explicitly requested.`;
}

function sendPrompt(prompt: string, pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
    return;
  }

  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  ctx.ui.notify("Ayu command queued as follow-up.", "info");
}

export function createWriteModeEditorFactory(state: AyuState, ctx: ExtensionContext) {
  return (
    tui: ConstructorParameters<typeof WriteModeEditor>[0],
    theme: ConstructorParameters<typeof WriteModeEditor>[1],
    keybindings: ConstructorParameters<typeof WriteModeEditor>[2],
  ) => new WriteModeEditor(tui, theme, keybindings, state, ctx.ui.theme);
}

export default function ayu(pi: ExtensionAPI) {
  const state: AyuState = {
    writeEnabled: false,
    activeTui: undefined,
  };
  const oneShotWriteMode = {
    pending: false,
    active: false,
  };

  function clearOneShotWriteMode(): void {
    oneShotWriteMode.pending = false;
    oneShotWriteMode.active = false;
  }

  pi.registerShortcut("alt+s", {
    description: "Toggle Ayu Write Mode for this session",
    handler: async (ctx) => {
      clearOneShotWriteMode();
      toggleWriteMode(state, ctx);
    },
  });

  pi.registerCommand("ayu", {
    description:
      "Ayu workflow router: Write Gate, task planning, review, docs sync, release check, verification, and project audit",
    handler: async (args, ctx) => {
      setWriteStatus(state, ctx);

      const trimmed = args.trim();
      const helpText = buildHelpText(state.writeEnabled);

      if (!trimmed || trimmed === "help") {
        ctx.ui.notify(helpText, "info");
        return;
      }

      const parts = trimmed.split(/\s+/);
      const first = parts[0] ?? "";
      const second = parts[1] ?? "";
      const writeAction = first === "write" ? second : first;
      const writePromptStart = first === "write" ? 2 : 1;

      if (writeAction === "on") {
        const prompt = parts.slice(writePromptStart).join(" ");
        clearOneShotWriteMode();
        setWriteEnabled(state, true, ctx);

        if (prompt) {
          oneShotWriteMode.pending = true;
          sendPrompt(prompt, pi, ctx);
        }
        return;
      }

      if (writeAction === "off") {
        const trailingPrompt = parts.slice(writePromptStart).join(" ");
        clearOneShotWriteMode();
        setWriteEnabled(state, false, ctx);

        if (trailingPrompt) {
          ctx.ui.notify("Ayu: Write Mode Off. Ignored trailing prompt after off.", "warning");
        }
        return;
      }

      if (writeAction === "status") {
        ctx.ui.notify(`Ayu Write Mode: ${state.writeEnabled ? "On" : "Off"}`, "info");
        return;
      }

      if (first === "settings") {
        ctx.ui.notify(
          "Ayu settings were removed. Use Alt+S or /ayu [write] on|off to control session Write Mode.",
          "warning",
        );
        return;
      }

      const prompt = await loadPrompt(first, parts.slice(1).join(" "));
      if (!prompt) {
        ctx.ui.notify(helpText, "warning");
        return;
      }

      sendPrompt(prompt, pi, ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    state.writeEnabled = false;
    state.activeTui = undefined;
    clearOneShotWriteMode();
    ctx.ui.setEditorComponent(createWriteModeEditorFactory(state, ctx));
    setWriteStatus(state, ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    ctx.ui.setEditorComponent(createWriteModeEditorFactory(state, ctx));
    setWriteStatus(state, ctx);
  });

  pi.on("session_shutdown", async () => {
    state.activeTui = undefined;
  });

  pi.on("before_agent_start", async (event) => {
    if (!state.writeEnabled) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${buildWriteModeOffPrompt()}`,
      };
    }

    if (oneShotWriteMode.pending) {
      oneShotWriteMode.pending = false;
      oneShotWriteMode.active = true;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildWriteModeOnPrompt()}`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!oneShotWriteMode.active) return;

    clearOneShotWriteMode();
    setWriteEnabled(state, false, ctx);

    if (ctx.hasUI) {
      ctx.ui.notify("Ayu Write Mode automatically turned Off after one-shot prompt.", "info");
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    setWriteStatus(state, ctx);

    if (state.writeEnabled) return undefined;

    const blockReason = getLockedToolBlockReason(event.toolName, event.input);
    if (!blockReason) return undefined;

    if (ctx.hasUI) {
      ctx.ui.notify(
        `${blockReason} Turn Write Mode On with Alt+S or /ayu [write] on before implementation.`,
        "warning",
      );
    }

    return {
      block: true,
      reason: `${blockReason} Turn Write Mode On with Alt+S or /ayu [write] on before implementation or mutating verification.`,
    };
  });
}

export { getLockedToolBlockReason, isReadOnlyGitInspectionCommand } from "./gate";
export { applyPromptArguments, promptFiles, stripFrontmatter } from "./prompts";
export {
  applyWriteModeLabel,
  buildHelpText,
  buildStyledWriteModeLabel,
  buildWriteModeLabel,
  setWriteEnabled,
  setWriteStatus,
  toggleWriteMode,
  WriteModeEditor,
} from "./ui";
export type { AyuState, RenderTarget, StatusStyler, WriteStatusContext } from "./ui";
