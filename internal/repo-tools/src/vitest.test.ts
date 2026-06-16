import { describe, expect, test } from "vitest";

import {
  createRootVitestConfig,
  createWorkspaceVitestConfig,
  strictCoverageConfig,
  workspaceSourceAliases,
} from "./vitest";

describe("vitest helpers", () => {
  test("creates strict coverage config with defaults and include overrides", () => {
    expect(strictCoverageConfig()).toMatchObject({
      coverage: {
        provider: "v8",
        reporter: ["text"],
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    });
    expect(
      strictCoverageConfig({ include: ["scripts/**/*.ts"], reporter: ["text", "html"] }),
    ).toMatchObject({
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        include: ["scripts/**/*.ts"],
        thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    });
  });

  test("creates workspace and root configs with aliases", () => {
    expect(createWorkspaceVitestConfig()).toMatchObject({
      resolve: { alias: workspaceSourceAliases },
    });
    expect(createWorkspaceVitestConfig({ test: { testTimeout: 1 } })).toMatchObject({
      test: { testTimeout: 1 },
    });
    expect(createRootVitestConfig()).toMatchObject({
      test: {
        alias: workspaceSourceAliases,
        projects: ["extensions/*", "sdk/*", "internal/*", "scripts"],
        testTimeout: 15000,
      },
    });
    expect(createRootVitestConfig({ test: { testTimeout: 1 } })).toMatchObject({
      test: { testTimeout: 1 },
    });
  });
});
