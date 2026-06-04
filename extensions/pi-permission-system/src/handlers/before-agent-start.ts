import type {
  BeforeAgentStartEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  createActiveToolsCacheKey,
  createBeforeAgentStartPromptStateKey,
} from "#src/before-agent-start-cache";
import type { PermissionSession } from "#src/permission-session";
import { resolveSkillPromptEntries } from "#src/skill-prompt-sanitizer";
import { sanitizeAvailableToolsSection } from "#src/system-prompt-sanitizer";
import { getToolNameFromValue, type ToolRegistry } from "#src/tool-registry";
import type { PermissionState } from "#src/types";

/** Minimal subset of BeforeAgentStartEvent used by this handler. */
interface BeforeAgentStartPayload {
  systemPrompt: string;
}

/**
 * Pure helper: returns true when the tool should be exposed to the agent.
 * Checks the tool-level permission (not command-level) so that a blanket
 * `bash: deny` hides the tool entirely before any invocation is attempted.
 */
export function shouldExposeTool(
  toolName: string,
  agentName: string | null,
  getToolPermission: (toolName: string, agentName?: string) => PermissionState,
): boolean {
  const toolPermission = getToolPermission(toolName, agentName ?? undefined);
  return toolPermission !== "deny";
}

/**
 * Handles the `before_agent_start` event: tool filtering + prompt sanitization.
 *
 * Constructor deps:
 * - `session` — encapsulates all mutable session state
 * - `toolRegistry` — Pi tool API subset (getAll + setActive)
 */
export class AgentPrepHandler {
  constructor(
    private readonly session: PermissionSession,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async handle(
    event: BeforeAgentStartPayload,
    ctx: ExtensionContext,
  ): Promise<BeforeAgentStartEventResult> {
    this.session.activate(ctx);
    this.session.refreshConfig(ctx);

    const agentName = this.session.resolveAgentName(ctx, event.systemPrompt);
    const allTools = this.toolRegistry.getAll();
    const allowedTools: string[] = [];

    for (const tool of allTools) {
      const toolName = getToolNameFromValue(tool);
      if (!toolName) {
        continue;
      }
      if (shouldExposeTool(toolName, agentName, (t, a) => this.session.getToolPermission(t, a))) {
        allowedTools.push(toolName);
      }
    }

    const activeToolsCacheKey = createActiveToolsCacheKey(allowedTools);
    if (this.session.shouldUpdateActiveTools(activeToolsCacheKey)) {
      this.toolRegistry.setActive(allowedTools);
      this.session.commitActiveToolsCacheKey(activeToolsCacheKey);
    }

    const promptStateCacheKey = createBeforeAgentStartPromptStateKey({
      agentName,
      cwd: ctx.cwd,
      permissionStamp: this.session.getPolicyCacheStamp(agentName ?? undefined),
      systemPrompt: event.systemPrompt,
      allowedToolNames: allowedTools,
    });

    if (!this.session.shouldUpdatePromptState(promptStateCacheKey)) {
      return {};
    }

    this.session.commitPromptStateCacheKey(promptStateCacheKey);

    const toolPromptResult = sanitizeAvailableToolsSection(event.systemPrompt, allowedTools);
    const skillPromptResult = resolveSkillPromptEntries(
      toolPromptResult.prompt,
      this.session,
      agentName,
      ctx.cwd,
    );
    this.session.setActiveSkillEntries(skillPromptResult.entries);

    if (skillPromptResult.prompt !== event.systemPrompt) {
      return { systemPrompt: skillPromptResult.prompt };
    }

    return {};
  }
}
