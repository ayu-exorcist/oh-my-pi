import { createWorkspaceVitestConfig } from "@ayulab/repo-tools/vitest";

export default createWorkspaceVitestConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
