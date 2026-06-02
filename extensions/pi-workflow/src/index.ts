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
  /ayu task <goal>           Discuss/plan: clarify scope and verification; no edits
  /ayu review [focus]        Review current git diff and decide whether more work is needed
  /ayu docs [scope]          Check README/docs/CHANGELOG sync need before editing docs
  /ayu release [scope]       Check release readiness; never publish/tag/push
  /ayu verify [criteria]     Summarize verification evidence after implementation
  /ayu audit [scope]         Audit project AI engineering setup using Ayu workflow
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
