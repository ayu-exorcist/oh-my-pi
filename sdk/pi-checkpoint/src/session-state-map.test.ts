import { describe, expect, test } from "vitest";
import { SessionStateMap } from "./session-state-map";

describe("SessionStateMap", () => {
  test("get creates state via factory when missing", () => {
    const map = new SessionStateMap<string>();
    const state = map.get("s1", () => "created");
    expect(state).toBe("created");
  });

  test("get returns cached state", () => {
    const map = new SessionStateMap<string>();
    map.get("s1", () => "first");
    const state = map.get("s1", () => "second");
    expect(state).toBe("first");
  });

  test("getOrUndefined returns undefined when missing", () => {
    const map = new SessionStateMap<string>();
    expect(map.getOrUndefined("s1")).toBeUndefined();
  });

  test("set overwrites existing state", () => {
    const map = new SessionStateMap<string>();
    map.get("s1", () => "first");
    map.set("s1", "overwritten");
    expect(map.getOrUndefined("s1")).toBe("overwritten");
  });

  test("delete removes state", () => {
    const map = new SessionStateMap<string>();
    map.get("s1", () => "state");
    expect(map.delete("s1")).toBe(true);
    expect(map.getOrUndefined("s1")).toBeUndefined();
  });

  test("delete returns false for missing session", () => {
    const map = new SessionStateMap<string>();
    expect(map.delete("s1")).toBe(false);
  });

  test("has checks existence", () => {
    const map = new SessionStateMap<string>();
    expect(map.has("s1")).toBe(false);
    map.get("s1", () => "state");
    expect(map.has("s1")).toBe(true);
  });

  test("clear removes all sessions", () => {
    const map = new SessionStateMap<string>();
    map.get("s1", () => "a");
    map.get("s2", () => "b");
    map.clear();
    expect(map.has("s1")).toBe(false);
    expect(map.has("s2")).toBe(false);
    expect(map.size).toBe(0);
  });

  test("size returns count", () => {
    const map = new SessionStateMap<string>();
    expect(map.size).toBe(0);
    map.get("s1", () => "a");
    expect(map.size).toBe(1);
    map.get("s2", () => "b");
    expect(map.size).toBe(2);
  });
});
