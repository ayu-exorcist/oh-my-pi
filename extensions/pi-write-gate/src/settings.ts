import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isRecord } from "./gate";
import type { RiskRule } from "./gate";

export interface AllowlistConfig {
  readonly bash?: readonly string[];
  readonly tools?: readonly string[];
}

export interface GateSettings {
  riskRules?: readonly RiskRule[];
  protectedPaths?: readonly string[];
  allowlist?: AllowlistConfig;
  approver?: "rule-based" | "classifier";
}

function isValidRiskRule(value: unknown): value is RiskRule {
  return (
    isRecord(value) &&
    typeof value.pattern === "string" &&
    (value.tier === "T2" || value.tier === "T3" || value.tier === "T4")
  );
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isValidAllowlist(value: unknown): value is AllowlistConfig {
  if (!isRecord(value)) return false;
  if (value.bash !== undefined && !isStringArray(value.bash)) return false;
  if (value.tools !== undefined && !isStringArray(value.tools)) return false;
  return true;
}

export async function loadGateSettings(cwd: string): Promise<GateSettings | undefined> {
  if (!cwd) return undefined;
  for (const settingsPath of [
    path.join(cwd, ".pi", "settings.json"),
    path.join(os.homedir(), ".pi", "agent", "settings.json"),
  ]) {
    try {
      const content = await readFile(settingsPath, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (!isRecord(parsed)) continue;
      const writeGate = parsed.writeGate;
      if (!isRecord(writeGate)) continue;

      const result: GateSettings = {};

      const rules = writeGate.riskRules;
      if (Array.isArray(rules)) {
        const validRules = rules.filter(isValidRiskRule);
        if (validRules.length > 0) result.riskRules = validRules;
      }

      const protectedPaths = writeGate.protectedPaths;
      if (isStringArray(protectedPaths) && protectedPaths.length > 0) {
        result.protectedPaths = protectedPaths;
      }

      const allowlist = writeGate.allowlist;
      if (isValidAllowlist(allowlist)) {
        result.allowlist = allowlist;
      }

      const approver = writeGate.approver;
      if (approver === "rule-based" || approver === "classifier") {
        result.approver = approver;
      }

      if (result.riskRules || result.protectedPaths || result.allowlist || result.approver) {
        return result;
      }
    } catch {
      // File missing or malformed — fall through to next path
    }
  }
  return undefined;
}
