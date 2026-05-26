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
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html"],
    },
  },
});
