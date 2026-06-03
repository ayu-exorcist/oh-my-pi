import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadPrompt } from "./prompts";

export function sendPrompt(prompt: string, pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
    return;
  }

  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  ctx.ui.notify("Ayu command queued as follow-up.", "info");
}

export function buildHelpText(): string {
  return `Ayu workflow

Commands:
  /ayu goal <objective>      Autonomous execution: persist until fully complete and verified
  /ayu task <goal>           Discuss/plan: clarify scope and verification; no edits
  /ayu plan <goal>           Read-only research and structured planning before implementation
  /ayu bug <description>     Diagnose and fix bug following reproduce→test→fix→verify
  /ayu review [focus]        Review current git diff for spec compliance and code quality
  /ayu docs [scope]          Check README/docs/CHANGELOG sync need before editing docs
  /ayu release [scope]       Check release readiness; never publish/tag/push
  /ayu verify [criteria]     Summarize verification evidence after implementation
  /ayu audit [scope]         Audit project AI engineering setup using Ayu workflow
  /ayu journal               Update session journal with decisions, blockers, and next steps
  /ayu harness-iteration     Draft a harness iteration card from a recent failure
  /ayu benchmark [suite]     Run benchmark evaluation and produce a run report
  /ayu help                  Show this help`;
}

export default function ayu(pi: ExtensionAPI) {
  pi.registerCommand("ayu", {
    description:
      "Ayu workflow router: task planning, review, docs sync, release check, verification, and project audit",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const helpText = buildHelpText();

      if (!trimmed || trimmed === "help") {
        ctx.ui.notify(helpText, "info");
        return;
      }

      const parts = trimmed.split(/\s+/);
      const first = parts[0] ?? "";

      const prompt = await loadPrompt(first, parts.slice(1).join(" "));
      if (!prompt) {
        ctx.ui.notify(helpText, "warning");
        return;
      }

      sendPrompt(prompt, pi, ctx);
    },
  });
}

export { applyPromptArguments, promptFiles, stripFrontmatter } from "./prompts";
