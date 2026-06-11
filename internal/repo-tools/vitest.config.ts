import { createWorkspaceVitestConfig, strictCoverageConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    ...strictCoverageConfig({ include: ["src/dist-manifest.ts", "src/testing.ts"] }),
  },
});
