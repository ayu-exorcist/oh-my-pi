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
      {
        find: /^@ayulab\/pi-session$/,
        replacement: "../../sdk/pi-session/src/index.ts",
      },
    ],
  },
});
