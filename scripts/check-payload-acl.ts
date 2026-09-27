/**
 * Runs the real-Payload ACL reference outside workspace dependency resolution.
 * A retained tarball is mandatory; this gate never builds, publishes, upgrades
 * the root installation or contacts an existing Payload deployment.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PACKAGE_SMOKE_INSTALL_ARGS,
  findPackageSmokeIsolationViolations,
  sanitizeNpmScriptEnvironment,
} from './release-contracts';

const { values } = parseArgs({
  options: {
    tarball: { type: 'string' },
    online: { type: 'boolean' },
    unsaved: { type: 'boolean' },
    'related-drafts': { type: 'boolean' },
    'require-related-drafts': { type: 'boolean' },
  },
});
assert.ok(
  values.tarball,
  'Usage: npm run test:acl:real-payload -- --tarball /absolute/package.tgz [--online] [--unsaved | --related-drafts [--require-related-drafts]]',
);
assert.ok(!(values.unsaved && values['related-drafts']), 'Select one fixture mode');
assert.ok(
  !values['require-related-drafts'] || values['related-drafts'],
  'The required-contract mode requires --related-drafts',
);
const tarball = resolve(values.tarball);
const digest = createHash('sha256')
  .update(await readFile(tarball))
  .digest('hex');
const repository = process.cwd();
const fixture = resolve(repository, 'tests/fixtures/payload-acl');
const directory = await mkdtemp(resolve(tmpdir(), 'plp-acl-consumer-'));
const command = (executable: string, args: string[], cwd: string): void => {
  const result = spawnSync(executable, args, {
    cwd,
    stdio: 'inherit',
    timeout: 180_000,
    env: sanitizeNpmScriptEnvironment(process.env),
  });
  assert.equal(
    result.status,
    0,
    `ACL command failed: ${executable} (status ${String(result.status)})`,
  );
};
try {
  assert.deepEqual(findPackageSmokeIsolationViolations(repository, directory), []);
  for (const name of ['package.json', 'package-lock.json', '.npmrc']) {
    await copyFile(resolve(fixture, name), resolve(directory, name));
  }
  await copyFile(
    resolve(repository, 'examples/payload-backend/acl-fixture.ts'),
    resolve(directory, 'acl-fixture.ts'),
  );
  // SQLite's platform binary is an optional dependency, so this consumer must
  // retain optional packages. Install-script and peer policies stay intact.
  const install = PACKAGE_SMOKE_INSTALL_ARGS.filter(
    (arg) => arg !== '--omit=optional' && arg !== '--offline',
  );
  const connectivity = values.online ? '--prefer-offline' : '--offline';
  command(
    'npm',
    [
      'ci',
      ...install.filter((arg) => arg !== '--package-lock=false' && arg !== '--no-save'),
      connectivity,
    ],
    directory,
  );
  command('npm', ['install', tarball, ...install, connectivity], directory);
  command(
    process.execPath,
    [
      resolve(repository, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--skipLibCheck',
      '--strict',
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--target',
      'es2022',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      'acl-fixture.ts',
    ],
    directory,
  );
  console.log(
    JSON.stringify({
      tarballSHA256: digest,
      transport: 'loopback HTTP',
      store: 'process-local reference',
    }),
  );
  command(
    process.execPath,
    [
      '--import',
      'tsx',
      values['related-drafts']
        ? 'tests/reproductions/preview-related-drafts.ts'
        : values.unsaved
          ? 'tests/reproductions/preview-unsaved-payload.ts'
          : 'tests/reproductions/preview-continuation-payload-acl.ts',
      directory,
      ...(values['require-related-drafts'] ? ['--require-related-drafts'] : []),
    ],
    repository,
  );
} finally {
  // The only recursive removal is the exact directory this invocation created.
  await rm(directory, { recursive: true, force: true });
}
