/**
 * Install only a newly prepared modern consumer with npm12's strict peers.
 * The exact direct versions and official family integrities are reviewed again
 * after installation; no force, legacy-peer or unrestricted script option exists.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preparedContract, digest, json } from './inputs.mjs';
import { verifyOwnedGraph } from './owned-graph.mjs';

assert.equal(process.argv.length, 3);
const prepared = preparedContract(process.argv[2]);
assert.ok(['v3', 'v4'].includes(prepared.lane));
assert.ok(
  !existsSync(resolve(prepared.app, 'package-lock.json')) &&
    !existsSync(resolve(prepared.app, 'node_modules')),
);
const version = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 10_000 });
assert.equal(version.status, 0);
assert.ok(!version.error);
assert.equal(version.stdout.trim(), '12.0.2');
const npmEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^npm_config_(?:allow_scripts|dangerously_allow_all_scripts|ignore_scripts|force|legacy_peer_deps)$/iu.test(
        key,
      ),
  ),
);
const env = { ...npmEnv, NODE_PATH: '', NODE_OPTIONS: '' };
const invoke = (args) => {
  const result = spawnSync('npm', args, {
    cwd: prepared.app,
    env,
    stdio: 'inherit',
    timeout: 900_000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.ok(!result.error);
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
const lock = resolve(prepared.app, 'package-lock.json');
const lockSHA256 = digest(lock);
writeFileSync(resolve(prepared.out, 'dependency-lock-before-install.json'), readFileSync(lock), {
  flag: 'wx',
  mode: 0o600,
});
invoke([
  'ci',
  '--strict-peer-deps',
  '--install-links',
  '--no-audit',
  '--no-fund',
  '--ignore-scripts=false',
  '--dangerously-allow-all-scripts=false',
]);
assert.equal(digest(lock), lockSHA256);
const graph = verifyOwnedGraph(prepared, prepared.laneDefinition, lockSHA256);
json(resolve(prepared.out, 'install.json'), {
  status: 'strict-installed-own-consumer-passed-native-not-executed',
  npm: version.stdout.trim(),
  node: process.version,
  installedAt: new Date().toISOString(),
  lockSHA256,
  graph,
});
console.log(
  JSON.stringify({
    status: 'strict-installed-own-consumer-passed-native-not-executed',
    lockSHA256,
  }),
);
