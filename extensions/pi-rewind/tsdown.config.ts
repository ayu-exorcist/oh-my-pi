import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/commands/rewind.ts"],
  format: "esm",
  dts: false,
  clean: true,
  deps: {
    alwaysBundle: ["@ayulab/pi-checkpoint"],
  },
});
