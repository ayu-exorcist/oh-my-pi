export type JsonObject = Record<string, unknown>;

export const directlyBlockedWhileLockedTools = new Set(["write", "edit"]);

export const mutatingToolNamePattern =
  /(?:^|[_.:-])(write|edit|patch|apply|delete|remove|rename|move|copy|create|update|save|append|truncate|replace|mkdir|touch|commit|push|publish|release|exec|execute|run|bash|shell|terminal)(?:$|[_.:-])/i;

export const dangerousShellSyntaxPattern = /[\r\n;&|<>`]|[$][(]/;

const disallowedGitInspectionOptions = new Set(["--ext-diff", "--textconv"]);
const disallowedGitInspectionOptionPrefixes = ["--output"];
const safeMcpActions = new Set(["server", "search", "describe", "connect", "action"]);

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;

  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

export function getArrayField(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined;

  const field = value[key];
  return Array.isArray(field) ? field : undefined;
}

export function isToolNamePotentiallyMutating(toolName: string): boolean {
  return mutatingToolNamePattern.test(toolName);
}

export function isBashToolName(toolName: string): boolean {
  return toolName === "bash" || toolName.endsWith(".bash");
}

export function hasDisallowedGitInspectionOption(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    if (disallowedGitInspectionOptions.has(token)) return true;

    return disallowedGitInspectionOptionPrefixes.some(
      (prefix) => token === prefix || token.startsWith(`${prefix}=`),
    );
  });
}

export function isReadOnlyGitInspectionCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || dangerousShellSyntaxPattern.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] !== "git") return false;

  let subcommandIndex = 1;
  if (tokens[subcommandIndex] === "--no-pager") {
    subcommandIndex += 1;
  }

  const subcommand = tokens[subcommandIndex];
  const args = tokens.slice(subcommandIndex + 1);
  if (!subcommand || hasDisallowedGitInspectionOption(args)) return false;

  if (subcommand === "status" || subcommand === "diff" || subcommand === "log") return true;

  if (subcommand === "show") {
    return !args.includes("--format=raw") && !args.includes("--format=medium");
  }

  if (subcommand === "branch") {
    return args.length === 1 && args[0] === "--show-current";
  }

  return false;
}

export function getNestedToolBlockReason(toolUse: unknown): string | undefined {
  const recipientName = getStringField(toolUse, "recipient_name");
  if (!recipientName) return undefined;

  if (isBashToolName(recipientName)) {
    const parameters = isRecord(toolUse) ? toolUse.parameters : undefined;
    const command = getStringField(parameters, "command");
    return command && isReadOnlyGitInspectionCommand(command)
      ? undefined
      : `Ayu write gate blocked nested tool ${recipientName} while locked.`;
  }

  return isToolNamePotentiallyMutating(recipientName)
    ? `Ayu write gate blocked nested tool ${recipientName} while locked.`
    : undefined;
}

export function getLockedToolBlockReason(toolName: string, input: unknown): string | undefined {
  if (isBashToolName(toolName)) {
    const command = getStringField(input, "command");
    if (command && isReadOnlyGitInspectionCommand(command)) return undefined;

    return `Ayu write gate blocked ${toolName} while locked.`;
  }

  if (directlyBlockedWhileLockedTools.has(toolName)) {
    return `Ayu write gate blocked ${toolName} while locked.`;
  }

  if (toolName === "multi_tool_use.parallel") {
    const nestedTools = getArrayField(input, "tool_uses") ?? [];
    const blockReason = nestedTools.map(getNestedToolBlockReason).find(Boolean);

    return blockReason;
  }

  if (toolName === "mcp") {
    const actionKeys = Object.keys(isRecord(input) ? input : {}).filter((key) => key !== "args");
    const hasOnlySafeActions = actionKeys.every((key) => safeMcpActions.has(key));
    const mcpTool = getStringField(input, "tool");

    if (!hasOnlySafeActions || (mcpTool && isToolNamePotentiallyMutating(mcpTool))) {
      return "Ayu write gate blocked a potentially mutating MCP call while locked.";
    }

    return undefined;
  }

  if (isToolNamePotentiallyMutating(toolName)) {
    return `Ayu write gate blocked potentially mutating tool ${toolName} while locked.`;
  }

  return undefined;
}
