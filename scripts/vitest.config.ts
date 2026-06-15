import { createWorkspaceVitestConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    include: ["**/*.test.ts"],
  },
});
