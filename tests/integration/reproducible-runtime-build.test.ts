/**
 * The build step that embeds a timestamp must produce the same bytes twice.
 *
 * `scripts/build-runtime.ts` writes `RUNTIME_BUILD_INFO.generatedAt` into the
 * generated runtime, and `index.js`/`index.cjs` carry that string into `dist`.
 * With a wall clock there, two builds of one commit had the same raw length and
 * the same gzip but six different bytes — invisible to those two metrics and
 * visible to brotli, which is how the size gate came to answer differently on
 * two machines with no change in between.
 *
 * `.github/workflows/build.yml` has always derived `SOURCE_DATE_EPOCH` from the
 * tested commit; `package.json`'s `build:runtime` now derives it the same way,
 * from the same `git show -s --format=%ct HEAD`, so a developer sees the numbers
 * the gate sees. Two details of that script are deliberate. It is a `node -e`
 * program rather than a shell prefix, because `build:runtime` is also `pretest`
 * and therefore runs inside `npm run check`, which assumes no shell today
 * (`npm run build` already does, through `test:edge`). And it takes the builder
 * as an argument instead of naming it inside the program, so that knip still
 * reads `scripts/build-runtime.ts` as a referenced file rather than an orphan.
 *
 * What this file proves is the reproducibility of that one step, not of a whole
 * `npm run build`: two runs of the real builder against a copy of `src/`, byte
 * for byte. It says nothing about `tsup` in `build-dist.ts`, and it cannot see a
 * future non-clock input (a random id, an absolute path, an iteration order).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/** Everything `scripts/build-runtime.ts` reads, relative to the root it computes. */
const COPIED = [
  'src',
  'tsconfig.json',
  // `src/version.ts` reads the manifest, so the copy needs one; it is also what
  // makes the workspace an ES-module package, as the repository root is.
  'package.json',
  'scripts/build-runtime.ts',
  'scripts/source-date-epoch.ts',
  'scripts/serialize-source.ts',
] as const;

/** The five files the builder writes; all five must reproduce, not just the dated one. */
const GENERATED = [
  'runtime.generated.ts',
  'runtime-lean.generated.ts',
  'loader.generated.ts',
  'fragment.generated.ts',
  'route.generated.ts',
] as const;

/** The builder the wrapper runs; it is an argument so that knip still sees it. */
const BUILDER = 'scripts/build-runtime.ts';

const BUILD_TIMEOUT = 120_000;

function manifestScript(name: string): string {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const command = manifest.scripts?.[name];
  if (command === undefined) throw new Error(`package.json has no ${name} script`);
  return command;
}

/**
 * The wrapper's own source, taken from the manifest rather than restated here.
 * Reading it back is what keeps the two in step: reshape the script into a shell
 * prefix and this fails, which is the review this file is for.
 */
function wrapperProgram(): string {
  const command = manifestScript('build:runtime');
  const match = new RegExp(`^node -e "(?<program>[^"]*)" ${BUILDER}$`, 'u').exec(command);
  const program = match?.groups?.['program'];
  if (program === undefined) {
    throw new Error(`build:runtime is no longer a shell-free node -e program over ${BUILDER}`);
  }
  return program;
}

function headCommitEpoch(): string {
  return execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

/** The developer's environment, with the variable CI supplies taken back out. */
function environmentWithoutEpoch(): NodeJS.ProcessEnv {
  const { SOURCE_DATE_EPOCH: _supplied, ...environment } = process.env;
  return environment;
}

describe('the local build takes its timestamp from the commit, as CI does', () => {
  let workspace = '';
  let target = '';

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'plp-reproducible-'));
    // Node resolves `esbuild`, `terser` and the loader upwards from the copied
    // script, so the workspace needs the same modules and nothing else of the
    // repository. A copy rather than the repository itself: the control build
    // deliberately writes a wall-clock timestamp, and no test may inherit that.
    symlinkSync(resolve(ROOT, 'node_modules'), join(workspace, 'node_modules'), 'dir');
    for (const entry of COPIED) {
      cpSync(resolve(ROOT, entry), join(workspace, entry), { recursive: true });
    }
    target = join(workspace, BUILDER);
  }, BUILD_TIMEOUT);

  afterAll(() => {
    if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
  });

  /** Run the manifest's wrapper, with the builder it spawns pointed at the copy. */
  function build(environment: NodeJS.ProcessEnv): void {
    execFileSync(process.execPath, ['-e', wrapperProgram(), target], {
      cwd: ROOT,
      env: environment,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

  /** Digests, not contents: a failure here should name the file, not print 100 KB. */
  function generated(): Readonly<Record<string, string>> {
    const digests: Record<string, string> = {};
    for (const name of GENERATED) {
      const bytes = readFileSync(join(workspace, 'src/inline', name));
      digests[name] = createHash('sha256').update(bytes).digest('hex');
    }
    return digests;
  }

  function runtimeSource(): string {
    return readFileSync(join(workspace, 'src/inline/runtime.generated.ts'), 'utf8');
  }

  it(
    'writes the same bytes twice when nothing but the clock has moved',
    () => {
      build(environmentWithoutEpoch());
      const first = generated();
      build(environmentWithoutEpoch());
      const second = generated();

      expect(second).toEqual(first);
      const expected = new Date(Number(headCommitEpoch()) * 1_000).toISOString();
      expect(runtimeSource()).toContain(`generatedAt: ${JSON.stringify(expected)}`);
    },
    BUILD_TIMEOUT,
  );

  it(
    'keeps the epoch CI hands it, and moves the bytes when the epoch moves',
    () => {
      // The second half is the control: without it the equality above would
      // hold just as well for a builder that had stopped writing a date at all.
      build({ ...process.env, SOURCE_DATE_EPOCH: '1757000000' });
      const pinned = generated();

      expect(runtimeSource()).toContain('generatedAt: "2025-09-04T15:33:20.000Z"');
      build(environmentWithoutEpoch());
      expect(generated()).not.toEqual(pinned);
    },
    BUILD_TIMEOUT,
  );
});
