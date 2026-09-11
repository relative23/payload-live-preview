/** The version shapes a release accepts, and the npm dist-tag and Git tag each one gets. */

const STABLE_SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
// A changesets prerelease: `X.Y.Z-<label>.<n>` (e.g. `2.0.0-beta.0`). The
// label becomes the npm dist-tag, so a prerelease never lands on `latest`.
const PRERELEASE_SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-([a-z][a-z0-9]*)\.(?:0|[1-9][0-9]*)$/u;

export function isPackageVersion(version: string): boolean {
  return STABLE_SEMVER_PATTERN.test(version) || PRERELEASE_SEMVER_PATTERN.test(version);
}

function versionCore(version: string): readonly [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/u, 3).map(Number);
  return [major, minor, patch];
}

/**
 * The npm dist-tag for a version, given the version the registry serves as
 * `latest` (`undefined` before the first publish). npm moves a tag to whatever
 * is published under it, so the tag decides what `npm install <pkg>` resolves:
 *
 * - a prerelease `X.Y.Z-<label>.<n>` → `<label>`, so `2.0.0-beta.0` lands on
 *   `beta` and installs keep resolving the stable `latest`;
 * - a stable version whose major is below the major of `latest` → `legacy`, so
 *   a 1.x security fix published after 2.0.0 cannot take `latest` back (`1.x`
 *   itself is refused by npm as a dist-tag, it parses as a semver range);
 * - any other stable version → `latest`, refused when it is below `latest` in
 *   the same major, which would move `latest` backwards.
 *
 * A version of any other shape is refused (fail-closed).
 */
export function distTagForVersion(version: string, latest: string | undefined): string {
  const prerelease = PRERELEASE_SEMVER_PATTERN.exec(version);
  if (prerelease !== null) return prerelease[1] ?? 'next';
  if (!STABLE_SEMVER_PATTERN.test(version)) throw new Error(`invalid package version: ${version}`);
  if (latest === undefined) return 'latest';
  if (!isPackageVersion(latest)) throw new Error(`invalid latest version: ${latest}`);
  const [major, minor, patch] = versionCore(version);
  const [latestMajor, latestMinor, latestPatch] = versionCore(latest);
  if (major < latestMajor) return 'legacy';
  if (
    major === latestMajor &&
    (minor < latestMinor || (minor === latestMinor && patch < latestPatch))
  ) {
    throw new Error(
      `${version} is below latest ${latest} in the same major; publishing it would move latest backwards`,
    );
  }
  return 'latest';
}

export function releaseTagForVersion(version: string): string {
  if (!isPackageVersion(version)) throw new Error(`invalid package version: ${version}`);
  return `v${version}`;
}
