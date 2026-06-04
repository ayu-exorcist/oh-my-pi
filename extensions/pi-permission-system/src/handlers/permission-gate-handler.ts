import type { ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";

import { toRecord } from "#src/common";
import { emitDecisionEvent, type PermissionEventBus } from "#src/permission-events";
import { applyPermissionGate } from "#src/permission-gate";
import type { PromptPermissionDetails } from "#src/permission-prompter";
import {
  formatMissingToolNameReason,
  formatSkillAskPrompt,
  formatUnknownToolReason,
} from "#src/permission-prompts";
import type { PermissionSession } from "#src/permission-session";
import {
  checkRequestedToolRegistration,
  getToolNameFromValue,
  type ToolRegistry,
} from "#src/tool-registry";
import { describeBashExternalDirectoryGate } from "./gates/bash-external-directory";
import { describeBashPathGate } from "./gates/bash-path";
import type { GateRunnerDeps } from "./gates/descriptor";
import { isGateBypass } from "./gates/descriptor";
import { describeExternalDirectoryGate } from "./gates/external-directory";
import { describePathGate } from "./gates/path";
import { runGateCheck } from "./gates/runner";
import { describeSkillReadGate } from "./gates/skill-read";
import { describeToolGate } from "./gates/tool";
import type { ToolCallContext } from "./gates/types";

/** Minimal subset of InputEvent used by handleInput. */
interface InputPayload {
  text: string;
}

/**
 * Handles permission gate events: tool_call and input.
 *
 * Constructor deps:
 * - `session` — encapsulates all mutable session state and permission operations
 * - `events` — event bus for emitting permissions:decision broadcasts
 * - `toolRegistry` — Pi tool API subset (getAll + setActive)
 */
export class PermissionGateHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly events: PermissionEventBus,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async handleToolCall(
    event: unknown,
    ctx: ExtensionContext,
  ): Promise<{ block?: true; reason?: string }> {
    this.session.activate(ctx);

    const agentName = this.session.resolveAgentName(ctx);
    const toolName = getToolNameFromValue(event);

    if (!toolName) {
      return { block: true, reason: formatMissingToolNameReason() };
    }

    const registrationCheck = checkRequestedToolRegistration(toolName, this.toolRegistry.getAll());
    if (registrationCheck.status === "missing-tool-name") {
      return { block: true, reason: formatMissingToolNameReason() };
    }

    if (registrationCheck.status === "unregistered") {
      return {
        block: true,
        reason: formatUnknownToolReason(
          registrationCheck.requestedToolName,
          registrationCheck.availableToolNames,
        ),
      };
    }

    const input = getEventInput(event);
    const toolCallId =
      typeof (event as Record<string, unknown>).toolCallId === "string"
        ? ((event as Record<string, unknown>).toolCallId as string)
        : "";

    const tcc: ToolCallContext = {
      toolName,
      agentName,
      input,
      toolCallId,
      cwd: ctx.cwd,
    };

    // ── Shared gate adapter closures ─────────────────────────────────────
    const canConfirm = () => this.session.canPrompt(ctx);
    const promptPermission = (details: PromptPermissionDetails) =>
      this.session.prompt(ctx, details);
    const emitDecision: GateRunnerDeps["emitDecision"] = (e) => emitDecisionEvent(this.events, e);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- logger.review is a plain function closure; no this-binding issue
    const writeReviewLog = this.session.logger.review;
    const checkPermission: GateRunnerDeps["checkPermission"] = (
      surface,
      input,
      agent,
      sessionRules,
    ) => this.session.checkPermission(surface, input, agent, sessionRules);
    const getSessionRuleset = () => this.session.getSessionRuleset();
    const approveSessionRule = (surface: string, pattern: string) =>
      this.session.approveSessionRule(surface, pattern);

    // ── Shared runner deps (built once, reused for all gates) ────────────
    const runnerDeps: GateRunnerDeps = {
      checkPermission,
      getSessionRuleset,
      approveSessionRule,
      writeReviewLog,
      emitDecision,
      canConfirm,
      promptPermission,
    };

    // ── Skill-read gate (descriptor + runner) ───────────────────────────────
    const skillDescriptor = describeSkillReadGate(tcc, () => this.session.getActiveSkillEntries());
    if (skillDescriptor) {
      const skillResult = await runGateCheck(
        skillDescriptor,
        tcc.agentName,
        tcc.toolCallId,
        runnerDeps,
      );
      if (skillResult.action === "block") {
        return { block: true, reason: skillResult.reason };
      }
    }

    // ── Path gate for tools (descriptor + runner) ────────────────────────────
    const pathDesc = describePathGate(tcc, checkPermission, getSessionRuleset);
    if (pathDesc) {
      if (isGateBypass(pathDesc)) {
        if (pathDesc.log) {
          writeReviewLog(pathDesc.log.event, pathDesc.log.details);
        }
      } else {
        const pathResult = await runGateCheck(pathDesc, tcc.agentName, tcc.toolCallId, runnerDeps);
        if (pathResult.action === "block") {
          return { block: true, reason: pathResult.reason };
        }
      }
    }

    // ── External-directory gate (descriptor + runner) ────────────────────────
    const infraDirs = [
      ...this.session.getInfrastructureDirs(),
      ...this.session.getInfrastructureReadPaths(),
    ];
    const extDirDesc = describeExternalDirectoryGate(tcc, infraDirs);
    if (extDirDesc) {
      if (isGateBypass(extDirDesc)) {
        if (extDirDesc.log) {
          writeReviewLog(extDirDesc.log.event, extDirDesc.log.details);
        }
        if (extDirDesc.decision) {
          emitDecision(extDirDesc.decision);
        }
      } else {
        const extDirResult = await runGateCheck(
          extDirDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (extDirResult.action === "block") {
          return { block: true, reason: extDirResult.reason };
        }
      }
    }

    // ── Bash external-directory gate (descriptor + runner) ───────────────────
    const bashExtDesc = await describeBashExternalDirectoryGate(
      tcc,
      checkPermission,
      getSessionRuleset,
    );
    if (bashExtDesc) {
      if (isGateBypass(bashExtDesc)) {
        if (bashExtDesc.log) {
          writeReviewLog(bashExtDesc.log.event, bashExtDesc.log.details);
        }
      } else {
        const bashExtResult = await runGateCheck(
          bashExtDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (bashExtResult.action === "block") {
          return { block: true, reason: bashExtResult.reason };
        }
      }
    }

    // ── Bash path gate (descriptor + runner) ────────────────────────────────
    const bashPathDesc = await describeBashPathGate(tcc, checkPermission, getSessionRuleset);
    if (bashPathDesc) {
      if (isGateBypass(bashPathDesc)) {
        if (bashPathDesc.log) {
          writeReviewLog(bashPathDesc.log.event, bashPathDesc.log.details);
        }
      } else {
        const bashPathResult = await runGateCheck(
          bashPathDesc,
          tcc.agentName,
          tcc.toolCallId,
          runnerDeps,
        );
        if (bashPathResult.action === "block") {
          return { block: true, reason: bashPathResult.reason };
        }
      }
    }

    // ── Normal tool permission gate (descriptor + runner) ────────────────────
    const toolCheck = checkPermission(
      tcc.toolName,
      tcc.input,
      tcc.agentName ?? undefined,
      getSessionRuleset(),
    );
    const toolDescriptor = describeToolGate(tcc, toolCheck);
    toolDescriptor.preCheck = toolCheck;
    const toolResult = await runGateCheck(
      toolDescriptor,
      tcc.agentName,
      tcc.toolCallId,
      runnerDeps,
    );
    if (toolResult.action === "block") {
      return { block: true, reason: toolResult.reason };
    }

    return {};
  }

  async handleInput(event: InputPayload, ctx: ExtensionContext): Promise<InputEventResult> {
    this.session.activate(ctx);

    const skillName = extractSkillNameFromInput(event.text);
    if (!skillName) {
      return { action: "continue" };
    }

    const agentName = this.session.resolveAgentName(ctx);
    const check = this.session.checkPermission(
      "skill",
      { name: skillName },
      agentName ?? undefined,
    );

    if (check.state === "deny" && ctx.hasUI) {
      const notifyMessage = agentName
        ? `Skill '${skillName}' is not permitted for agent '${agentName}'.`
        : `Skill '${skillName}' is not permitted by the current skill policy.`;
      ctx.ui.notify(notifyMessage, "warning");
    }

    const skillInputMessage = formatSkillAskPrompt(skillName, agentName ?? undefined);
    const skillInputCanConfirm = this.session.canPrompt(ctx);
    let skillInputAutoApproved = false;
    const skillInputGate = await applyPermissionGate({
      state: check.state,
      canConfirm: skillInputCanConfirm,
      promptForApproval: async () => {
        const decision = await this.session.prompt(ctx, {
          requestId: this.session.createPermissionRequestId("skill-input"),
          source: "skill_input",
          agentName,
          message: skillInputMessage,
          skillName,
        });
        skillInputAutoApproved = decision.autoApproved === true;
        return decision;
      },
      // eslint-disable-next-line @typescript-eslint/unbound-method -- logger.review is a plain function closure; no this-binding issue
      writeLog: this.session.logger.review,
      logContext: {
        source: "skill_input",
        skillName,
        agentName,
        message: skillInputMessage,
      },
      messages: {
        denyReason: skillInputMessage,
        unavailableReason: "Skill requires approval, but no interactive UI is available.",
        userDeniedReason: () => "User denied skill.",
      },
    });

    emitDecisionEvent(this.events, {
      surface: "skill",
      value: skillName,
      result: skillInputGate.action === "allow" ? "allow" : "deny",
      /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive fallback; TypeScript narrows check.state before the ternary's else branch */
      resolution:
        check.state === "allow"
          ? "policy_allow"
          : check.state === "deny"
            ? "policy_deny"
            : skillInputGate.action === "allow"
              ? skillInputAutoApproved
                ? "auto_approved"
                : "user_approved"
              : skillInputCanConfirm
                ? "user_denied"
                : "confirmation_unavailable",
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ?? null normalises undefined to null for the log record
      origin: check.origin ?? null,
      agentName: agentName ?? null,
      matchedPattern: check.matchedPattern ?? null,
    });

    if (skillInputGate.action === "block") {
      return { action: "handled" };
    }

    return { action: "continue" };
  }
}

// ── Pure helpers (re-exported from original modules) ──────────────────────

/**
 * Extract the tool input from an event, checking both `input` and `arguments`
 * fields (different Pi SDK versions use different names).
 */
export function getEventInput(event: unknown): unknown {
  const record = toRecord(event);

  if (record.input !== undefined) {
    return record.input;
  }

  if (record.arguments !== undefined) {
    return record.arguments;
  }

  return {};
}

/**
 * Parse a `/skill:<name>` prefix from user input.
 * Returns the skill name, or null if the text is not a skill invocation.
 */
export function extractSkillNameFromInput(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/skill:")) {
    return null;
  }

  const afterPrefix = trimmed.slice("/skill:".length);
  if (!afterPrefix) {
    return null;
  }

  const firstWhitespace = afterPrefix.search(/\s/);
  const skillName = (
    firstWhitespace === -1 ? afterPrefix : afterPrefix.slice(0, firstWhitespace)
  ).trim();
  return skillName || null;
}
