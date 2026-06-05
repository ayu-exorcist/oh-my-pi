/** Bump a semver string by one patch version. */
export function bumpPatchVersion(version: string): string {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-.+)?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  return `${major}.${minor}.${patch + 1}`;
}
