/**
 * Resolve and retain this disposable consumer's complete dependency lock, then
 * install it with strict peers. Only the two exact native packages approved in
 * its private manifest may execute lifecycle scripts. Run after resource release.
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readRunSettings, verifyInstalledCandidate } from './identity.mjs';

if (process.env.PLP_P2_RESOURCES_RELEASED !== '1')
  throw new Error('Wait for the coordinator to release installation resources');
const here = dirname(fileURLToPath(import.meta.url));
const { settings, run, app } = readRunSettings(here, process.env.PLP_P2_RUN_FILE);
const archive = readFileSync(join(app, 'vendor', 'payload-live-preview.tgz'));
if (createHash('sha256').update(archive).digest('hex') !== settings.candidate.sha256)
  throw new Error('Candidate archive changed');
const npmVersion = spawnSync('npm', ['--version'], { cwd: app, encoding: 'utf8' });
if (npmVersion.status !== 0 || npmVersion.stdout.trim() !== '12.0.2')
  throw new Error('This prepared install requires npm 12.0.2 allowScripts semantics');
const npmEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^npm_config_(?:allow_scripts|dangerously_allow_all_scripts|ignore_scripts)$/iu.test(key),
  ),
);
const invoke = (args) => {
  const result = spawnSync('npm', args, {
    cwd: app,
    stdio: 'inherit',
    env: { ...npmEnv, NODE_PATH: '' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Consumer npm step failed with exit ' + result.status);
};
invoke([
  'install',
  '--package-lock-only',
  '--ignore-scripts',
  '--strict-peer-deps',
  '--install-links',
  '--no-audit',
  '--no-fund',
]);
const lock = readFileSync(join(app, 'package-lock.json'));
writeFileSync(join(settings.run, 'dependency-lock-before-install.json'), lock);
invoke([
  'ci',
  '--strict-peer-deps',
  '--install-links',
  '--no-audit',
  '--no-fund',
  '--ignore-scripts=false',
  '--dangerously-allow-all-scripts=false',
]);
const inventory = JSON.parse(readFileSync(join(run, 'archive-inventory.json'), 'utf8'));
const installed = verifyInstalledCandidate(app, settings.candidate, inventory);
const locked = JSON.parse(lock).packages?.['node_modules/payload-live-preview'];
if (
  locked?.integrity !== inventory.sha512Integrity ||
  locked.version !== settings.candidate.version ||
  locked.link
)
  throw new Error('Candidate lock is not the inspected immutable archive');
writeFileSync(
  join(run, 'install.json'),
  JSON.stringify(
    {
      installedAt: new Date().toISOString(),
      node: process.version,
      npm: npmVersion.stdout.trim(),
      variant: settings.variant,
      candidate: settings.candidate,
      lockSha256: createHash('sha256').update(lock).digest('hex'),
      installedCandidate: installed,
    },
    null,
    2,
  ) + '\n',
);
