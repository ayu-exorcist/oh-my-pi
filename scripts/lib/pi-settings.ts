import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { isRecord, isStringArray } from "@ayulab/runtime-core";

export async function readSettings(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeSettings(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function confirm(msg: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(msg, (ans) => resolve(ans.trim()));
    });
    return answer.toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export { isStringArray };
