import { describe, expect, test } from "vitest";
import { buildModePrompt, buildWriteModeOffPrompt, buildWriteModeOnPrompt } from "./prompt";

describe("prompt", () => {
  test("builds auto mode prompt", () => {
    const autoPrompt = buildModePrompt("auto");
    expect(autoPrompt).toContain("Write authorization is in Auto Mode");
    expect(autoPrompt).toContain("routine file edits and safe local commands");
    expect(autoPrompt).toContain("High-risk actions");
  });

  test("buildWriteModeOffPrompt returns off prompt", () => {
    const prompt = buildWriteModeOffPrompt();
    expect(prompt).toContain("Write authorization is Off");
  });

  test("buildWriteModeOnPrompt returns on prompt", () => {
    const prompt = buildWriteModeOnPrompt();
    expect(prompt).toContain("Write authorization is On");
  });
});
