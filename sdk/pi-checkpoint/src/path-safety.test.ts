import { describe, expect, test } from "vitest";
import {
  createCheckpointRef,
  encodeStorageComponent,
  isSafeCheckpointRef,
  isSafeStorageComponent,
  validateWorktreeId,
} from "./path-safety";

describe("path safety", () => {
  test("rejects unsafe raw storage components", () => {
    expect(isSafeStorageComponent("")).toBe(false);
    expect(isSafeStorageComponent(".")).toBe(false);
    expect(isSafeStorageComponent("..")).toBe(false);
    expect(isSafeStorageComponent("a/b")).toBe(false);
    expect(isSafeStorageComponent("badchar")).toBe(false);
    expect(isSafeStorageComponent("repo.git")).toBe(false);
    expect(isSafeStorageComponent("ok-id_123")).toBe(true);
  });

  test("encodes external ids into safe ref components", () => {
    const encoded = encodeStorageComponent("session/id:with unsafe chars");
    expect(isSafeStorageComponent(encoded)).toBe(true);
    expect(encoded).not.toContain("/");
  });

  test("creates encoded checkpoint refs", () => {
    const ref = createCheckpointRef("session/id", "entry/id", "before");
    expect(ref).toMatch(/^refs\/ayu\/checkpoints\/sessions\/[^/]+\/[^/]+\/before$/u);
    expect(isSafeCheckpointRef(ref)).toBe(true);
    expect(isSafeCheckpointRef("refs/ayu/checkpoints/sessions/raw/slash/extra/before")).toBe(false);
    expect(isSafeCheckpointRef("refs/heads/main")).toBe(false);
  });

  test("validates generated worktree ids", () => {
    const id = "a".repeat(64);
    expect(validateWorktreeId(id)).toBe(id);
    expect(() => validateWorktreeId("repo.git")).toThrow("Unsafe worktree id");
  });
});
