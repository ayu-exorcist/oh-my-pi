import { createWorkspaceVitestConfig, strictCoverageConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    ...strictCoverageConfig({ reporter: ["text", "html"] }),
  },
});
