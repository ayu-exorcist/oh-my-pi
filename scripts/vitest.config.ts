import { createWorkspaceVitestConfig, strictCoverageConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    include: ["**/*.test.ts"],
    ...strictCoverageConfig({ include: ["lib/git.ts", "lib/package-json.ts", "lib/validate.ts"] }),
  },
});
