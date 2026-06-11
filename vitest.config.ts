import { createRootVitestConfig } from "@ayulab/repo-tools/vitest";

/**
 * Root Vitest configuration for the monorepo.
 *
 * Uses workspace-aware `projects` so tests in `extensions/*`, `sdk/*`,
 * `internal/*`, and `scripts` pick up their local `vitest.config.ts` files.
 */
export default createRootVitestConfig();
