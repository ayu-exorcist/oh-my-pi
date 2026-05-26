import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@ayulab\/pi-checkpoint$/,
        replacement: "../../sdk/pi-checkpoint/src/index.ts",
      },
      {
        find: /^@ayulab\/pi-checkpoint\/testing$/,
        replacement: "../../sdk/pi-checkpoint/src/testing/index.ts",
      },
    ],
  },
  test: {
    globals: false,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
