import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { getLockedToolBlockReason, getWriteModeOnBlockReason } from "./gate";
import { buildModePrompt } from "./prompt";
import { buildHelpText, setWriteStatus, WriteModeEditor } from "./ui";
import type { WriteGateState } from "./ui";
import {
  restorePermissionModeForSessionStart,
  setAndPersistWriteMode,
  toggleAndPersistWriteMode,
} from "./state";
import { evaluatePolicy } from "./policy";
import { RuleBasedApprover } from "./approver";
import { ClassifierApprover } from "./classifier";
import { loadGateSettings } from "./settings";
import type { GateSettings } from "./settings";

export type GateCommandAction = "help" | "on" | "off" | "auto" | "status" | "unknown";

export interface GateCommandParseResult {
  readonly action: GateCommandAction;
  readonly ignoredTrailingPrompt: boolean;
}

export function parseGateCommandArgs(args: string): GateCommandParseResult {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help") {
    return { action: "help", ignoredTrailingPrompt: false };
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? "";
  const second = parts[1] ?? "";
  const writeAction = first === "write" ? second : first;
  const trailingStart = first === "write" ? 2 : 1;
  const hasTrailingPrompt = parts.slice(trailingStart).join(" ").trim().length > 0;

  if (writeAction === "on") {
    return { action: "on", ignoredTrailingPrompt: hasTrailingPrompt };
  }

  if (writeAction === "off") {
    return { action: "off", ignoredTrailingPrompt: hasTrailingPrompt };
  }

  if (writeAction === "auto") {
    return { action: "auto", ignoredTrailingPrompt: hasTrailingPrompt };
  }

  if (writeAction === "status") {
    return { action: "status", ignoredTrailingPrompt: false };
  }

  return { action: "unknown", ignoredTrailingPrompt: false };
}

export function createWriteModeEditorFactory(
  state: WriteGateState,
  ctx: ExtensionContext,
): (
  tui: ConstructorParameters<typeof WriteModeEditor>[0],
  theme: ConstructorParameters<typeof WriteModeEditor>[1],
  keybindings: ConstructorParameters<typeof WriteModeEditor>[2],
) => InstanceType<typeof WriteModeEditor> {
  return (
    tui: ConstructorParameters<typeof WriteModeEditor>[0],
    theme: ConstructorParameters<typeof WriteModeEditor>[1],
    keybindings: ConstructorParameters<typeof WriteModeEditor>[2],
  ) => new WriteModeEditor(tui, theme, keybindings, state, ctx.ui.theme);
}

export async function handleGateCommand(
  pi: ExtensionAPI,
  state: WriteGateState,
  args: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  setWriteStatus(state, ctx);

  const result = parseGateCommandArgs(args);
  const helpText = buildHelpText(state.mode);

  if (result.action === "help") {
    ctx.ui.notify(helpText, "info");
    return true;
  }

  if (result.action === "on") {
    setAndPersistWriteMode(pi, state, "on", ctx, "command");

    if (result.ignoredTrailingPrompt) {
      ctx.ui.notify(
        "Write Gate: Write Mode On. Ignored trailing prompt; send it as your next message.",
        "warning",
      );
    }
    return true;
  }

  if (result.action === "off") {
    setAndPersistWriteMode(pi, state, "off", ctx, "command");

    if (result.ignoredTrailingPrompt) {
      ctx.ui.notify("Write Gate: Write Mode Off. Ignored trailing prompt after off.", "warning");
    }
    return true;
  }

  if (result.action === "auto") {
    setAndPersistWriteMode(pi, state, "auto", ctx, "command");

    if (result.ignoredTrailingPrompt) {
      ctx.ui.notify(
        "Write Gate: Auto Mode enabled. Ignored trailing prompt; send it as your next message.",
        "warning",
      );
    }
    return true;
  }

  if (result.action === "status") {
    const labelMap: Record<string, string> = { off: "Off", on: "On", auto: "Auto" };
    ctx.ui.notify(`Write Mode: ${labelMap[state.mode] ?? state.mode}`, "info");
    return true;
  }

  ctx.ui.notify(helpText, "warning");
  return false;
}

const AUTO_FALLBACK_CONSECUTIVE = 3;
const AUTO_FALLBACK_TOTAL = 20;

export default function writeGate(pi: ExtensionAPI) {
  const state: WriteGateState = {
    mode: "off",
    activeTui: undefined,
  };

  let gateSettings: GateSettings | undefined;

  function createApprover(settings?: GateSettings) {
    if (settings?.approver === "classifier") {
      return new ClassifierApprover({});
    }
    return new RuleBasedApprover();
  }

  let approver = createApprover();

  // Auto mode fallback counters (reset per session)
  let autoConsecutiveBlocks = 0;
  let autoTotalBlocks = 0;

  function resetAutoCounters(): void {
    autoConsecutiveBlocks = 0;
    autoTotalBlocks = 0;
  }

  function recordAutoBlock(ctx: ExtensionContext): void {
    autoConsecutiveBlocks += 1;
    autoTotalBlocks += 1;

    if (
      autoConsecutiveBlocks >= AUTO_FALLBACK_CONSECUTIVE ||
      autoTotalBlocks >= AUTO_FALLBACK_TOTAL
    ) {
      setAndPersistWriteMode(pi, state, "on", ctx, "auto_fallback");
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Auto Mode paused after repeated blocks. Switched to On. Send /write-gate auto to re-enable.`,
          "warning",
        );
      }
      resetAutoCounters();
    }
  }

  pi.registerShortcut("alt+s", {
    description: "Cycle Write Mode (Off → On → Auto → Off)",
    handler: async (ctx) => {
      toggleAndPersistWriteMode(pi, state, ctx, "shortcut");
    },
  });

  pi.registerCommand("write-gate", {
    description: "Write Gate: Write Mode, Write Gate, and mutating tool protection",
    handler: async (args, ctx) => {
      await handleGateCommand(pi, state, args, ctx);
    },
  });

  pi.on("session_start", async (event: SessionStartEvent, ctx) => {
    state.mode = restorePermissionModeForSessionStart(event.reason, ctx);
    state.activeTui = undefined;
    resetAutoCounters();
    gateSettings = await loadGateSettings(ctx.cwd);
    approver = createApprover(gateSettings);
    ctx.ui.setEditorComponent(createWriteModeEditorFactory(state, ctx));
    setWriteStatus(state, ctx);

    if (event.reason === "startup" || event.reason === "resume") {
      const labelMap: Record<string, string> = { off: "Off", on: "On", auto: "Auto" };
      ctx.ui.notify(`Write Mode restored: ${labelMap[state.mode] ?? state.mode}`, "info");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    ctx.ui.setEditorComponent(createWriteModeEditorFactory(state, ctx));
    setWriteStatus(state, ctx);
  });

  pi.on("session_shutdown", async () => {
    state.activeTui = undefined;
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildModePrompt(state.mode)}`,
    };
  });

  pi.on("tool_call", async (event: { toolName: string; input: unknown }, ctx: ExtensionContext) => {
    setWriteStatus(state, ctx);

    if (state.mode === "on") {
      // Write Mode On still blocks T3/T4 commands as a safety net
      const onBlockReason = getWriteModeOnBlockReason(
        event.toolName,
        event.input,
        gateSettings?.riskRules,
      );
      if (onBlockReason) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            `${onBlockReason} (Write Mode is On, but this action requires explicit approval.)`,
            "warning",
          );
        }
        return { block: true, reason: onBlockReason };
      }
      return undefined;
    }

    if (state.mode === "auto") {
      const policy = evaluatePolicy(event.toolName, event.input, gateSettings);
      const decision = await approver.approve(event.toolName, policy);

      if (decision.kind === "allow") {
        // Any successful non-blocked action resets the consecutive counter
        autoConsecutiveBlocks = 0;
        return undefined;
      }

      // block in auto mode
      if (ctx.hasUI) {
        ctx.ui.notify(
          `${decision.reason} (Auto Mode blocked this action. Approve once to resume auto, or switch to On/Off.)`,
          "warning",
        );
      }
      recordAutoBlock(ctx);
      return { block: true, reason: decision.reason };
    }

    // state.mode === "off"
    const blockReason = getLockedToolBlockReason(event.toolName, event.input);
    if (!blockReason) return undefined;

    if (ctx.hasUI) {
      ctx.ui.notify(
        `${blockReason} Turn Write Mode On with Alt+S or /write-gate [write] on before implementation.`,
        "warning",
      );
    }

    return {
      block: true,
      reason: `${blockReason} Turn Write Mode On with Alt+S or /write-gate [write] on before implementation or mutating verification.`,
    };
  });
}

export {
  getLockedToolBlockReason,
  getWriteModeOnBlockReason,
  isReadOnlyGitInspectionCommand,
} from "./gate";
export { buildWriteModeOffPrompt, buildWriteModeOnPrompt } from "./prompt";
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
export {
  getLatestPersistedWriteEnabled,
  isPersistedWriteGateState,
  persistWriteMode,
  restoreWriteModeForSessionStart,
  setAndPersistWriteMode,
  shouldRestoreWriteMode,
  toggleAndPersistWriteMode,
  WRITE_GATE_STATE_ENTRY,
} from "./state";
export type { PersistedWriteGateState } from "./state";
export type { WriteGateState, RenderTarget, StatusStyler, WriteStatusContext } from "./ui";
