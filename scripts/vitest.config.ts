import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: [
        "lib/release-plan.ts",
        "lib/build-artifact.ts",
        "lib/build-artifact-stage.ts",
        "lib/guards.ts",
      ],
      reporter: ["text"],
      thresholds: {
        statements: 90,
        branches: 70,
        functions: 80,
        lines: 90,
      },
    },
  },
});
