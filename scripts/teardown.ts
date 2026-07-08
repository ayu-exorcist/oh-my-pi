import path from "node:path";
import { fileURLToPath } from "node:url";

import { updatePackageRegistration } from "./lib/package-registration";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

updatePackageRegistration({ action: "remove", repoRoot: REPO_ROOT }).catch((err) => {
  console.error(err);
  /* c8 ignore next */
  process.exit(1);
});
