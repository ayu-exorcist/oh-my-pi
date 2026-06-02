/**
 * Lightweight benchmark runner for pi-trace-lab.
 *
 * Reads a benchmark suite markdown and produces a benchmark-run-report.md
 * scaffold. Future work: spawn `pi --mode json` child processes to execute
 * tasks automatically, restore git state per task, and aggregate results.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface BenchmarkTask {
  id: string;
  type: string;
  scoringMode: string;
  taskCardPath: string;
  startingState: string;
  verificationCommand: string;
}

export interface BenchmarkSuite {
  name: string;
  model: string;
  tools: string[];
  tasks: BenchmarkTask[];
}

function parseSuiteMarkdown(content: string): BenchmarkSuite {
  const tasks: BenchmarkTask[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(
      /\|\s*(E|H)-[\w-]+\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/,
    );
    if (match) {
      tasks.push({
        id: match[1]!.trim(),
        type: match[2]!.trim(),
        scoringMode: match[3]!.trim(),
        taskCardPath: match[4]!.trim(),
        startingState: match[5]!.trim(),
        verificationCommand: match[6]!.trim(),
      });
    }
  }

  return {
    name: "benchmark-suite",
    model: "default",
    tools: [],
    tasks,
  };
}

export async function runBenchmark(
  ctx: ExtensionContext,
  suitePath: string,
  outputDir: string,
): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(suitePath, "utf8");
  } catch {
    ctx.ui.notify(`Benchmark: Could not read suite at ${suitePath}`, "error");
    return null;
  }

  const suite = parseSuiteMarkdown(content);
  if (suite.tasks.length === 0) {
    ctx.ui.notify("Benchmark: No tasks found in suite.", "warning");
    return null;
  }

  const now = new Date().toISOString().split("T")[0];
  const reportPath = path.join(outputDir, `benchmark-run-${now}.md`);

  const lines = [
    `# Benchmark Run Report`,
    ``,
    `- **Suite**: ${suitePath}`,
    `- **Date**: ${now}`,
    `- **Tasks**: ${suite.tasks.length}`,
    ``,
    `## Results`,
    ``,
    `| Task ID | Type | Scoring | Status | Verification | Notes |`,
    `|---|---|---|---|---|---|`,
  ];

  for (const task of suite.tasks) {
    lines.push(
      `| ${task.id} | ${task.type} | ${task.scoringMode} | pending | \`${task.verificationCommand}\` | |`,
    );
  }

  lines.push(
    ``,
    `## Protocol`,
    ``,
    `1. Restore each task to its starting state.`,
    `2. Run with fixed model/tools/settings.`,
    `3. Execute verification command.`,
    `4. Record pass/fail and failure mode.`,
    `5. For held-out tasks, run Pass^3 Lite (3 independent trials).`,
    ``,
    `## Metrics`,
    ``,
    `- Solve rate: _待填写_`,
    `- Regression count: _待填写_`,
    `- Avg tokens per task: _待填写_`,
    ``,
    `## Promote / Revert Recommendation`,
    ``,
    `- [ ] Held-out solve rate did not decrease`,
    `- [ ] Target metric improved`,
    `- [ ] No safety/test/API regression`,
    `- [ ] Pass^3 Lite passed for high-risk tasks`,
    ``,
  );

  await mkdir(outputDir, { recursive: true });
  await writeFile(reportPath, lines.join("\n"), "utf8");

  return reportPath;
}
