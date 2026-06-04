import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#src": fileURLToPath(new URL("./src", import.meta.url)),
      "#test": fileURLToPath(new URL("./test", import.meta.url)),
    },
  },
  test: {
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
