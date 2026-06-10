import { createWorkspaceVitestConfig, strictCoverageConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      ...strictCoverageConfig()?.coverage,
      include: ["lib/release-plan.ts", "lib/build-artifact-stage.ts", "lib/package-json.ts"],
    },
  },
});
