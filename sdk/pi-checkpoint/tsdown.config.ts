import { createTsdownConfig } from "@ayulab/repo-tools/tsdown";
import { defineConfig } from "tsdown";

export default defineConfig(
  createTsdownConfig({
    alwaysBundle: ["@ayulab/runtime-core"],
    dts: true,
  }),
);
