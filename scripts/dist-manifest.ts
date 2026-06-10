#!/usr/bin/env oxnode
import { fileURLToPath } from "node:url";
import { buildDistManifest } from "@ayulab/repo-tools/dist-manifest";

export { buildDistManifest } from "@ayulab/repo-tools/dist-manifest";

/* c8 ignore next 3 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildDistManifest(process.cwd());
}
