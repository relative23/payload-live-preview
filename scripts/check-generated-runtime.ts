/**
 * Is the committed runtime the one the source builds?
 *
 * `scripts/build-runtime.ts` writes six files into `src/inline/`. Five are
 * ignored and built wherever something needs them. One is committed,
 * `runtime-lean.generated.ts`, because `src/lean.ts` imports it as a module —
 * and a committed build output goes stale without anything failing.
 *
 * It did, twice, the same way. The runtime carries the package version through
 * `src/version.ts`, and the Version PR changes the manifest without building,
 * so the file still said `2.0.0-beta.0` in the release candidate and
 * `2.0.0-rc.1` in 2.0.0. What npm received was never wrong, because CI builds
 * fresh; what every local run and every unit test read was.
 * `tests/integration/reproducible-runtime-build.test.ts` could not see it: it
 * compares two builds with each other, never with the committed file.
 *
 * Run it after `npm run build:runtime`, as Lint & Typecheck does; without a
 * build first it compares the file with itself and passes. The files are the
 * ones git tracks under `src/inline/*.generated.ts`, so tracking another one
 * brings it under this check. `npm run version` builds the runtime after
 * versioning, so a Version PR carries the file it changes.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED = 'src/inline/*.generated.ts';

function gitLines(args: readonly string[]): string[] {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
}

function main(): void {
  const tracked = gitLines(['ls-files', '--', GENERATED]);
  if (tracked.length === 0) {
    // A check that finds nothing to compare would pass forever; say so instead.
    console.error(`[generated] git tracks no file matching ${GENERATED}; nothing to compare.`);
    process.exitCode = 1;
    return;
  }
  const stale = gitLines(['diff', '--name-only', '--', ...tracked]);
  if (stale.length === 0) {
    const verb = tracked.length === 1 ? 'matches' : 'match';
    console.log(`[generated] ${tracked.join(', ')} ${verb} the build.`);
    return;
  }
  console.error(
    `[generated] ${String(stale.length)} committed file(s) differ from what the source builds:\n` +
      stale.map((path) => `  - ${path}`).join('\n') +
      `\n\nCommit the rebuilt file with the change that altered it:\n` +
      `  npm run build:runtime && git add ${stale.join(' ')}`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
