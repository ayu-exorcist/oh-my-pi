import { createRootVitestConfig, strictCoverageConfig } from "@ayulab/repo-tools/vitest";

export default createRootVitestConfig({
  test: {
    ...strictCoverageConfig({
      include: [
        "extensions/**/src/**/*.{ts,tsx}",
        "sdk/**/src/**/*.{ts,tsx}",
        "internal/**/src/**/*.{ts,tsx}",
        "scripts/**/*.ts",
      ],
      reporter: ["text", "html"],
    }),
  },
});
