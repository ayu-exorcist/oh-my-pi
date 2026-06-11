import { createWorkspaceVitestConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    testTimeout: 15000,
  },
});
