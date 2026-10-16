/**
 * Verify one independently installed lane without a workspace peer fallback.
 * Required family/Next/React peers and all installed SDK files must match the
 * reviewed exact manifest, official receipts and selected archive inventory.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { resolveConsumerImport } from './shared/resolve-consumer-import.mjs';

export const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const inside = (path, parent) => path.startsWith(parent + sep);

function peerIdentity(from, name, modules) {
  // This export-only package is identified through the entry used by the admin.
  const specifier = name === '@payloadcms/next' ? '@payloadcms/next/withPayload' : name;
  const entry = resolveConsumerImport(from, specifier);
  assert.ok(inside(entry, modules), 'Required peer resolved outside the own consumer: ' + name);
  let directory = dirname(entry);
  while (inside(directory, modules)) {
    let manifest;
    try {
      manifest = read(resolve(directory, 'package.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (manifest?.name === name)
      return { entry, packageRoot: directory, version: manifest.version };
    directory = dirname(directory);
  }
  throw new Error('Resolved required peer has no matching own package manifest: ' + name);
}

export function verifyOwnedGraph(prepared, lane, lockSHA256) {
  const app = realpathSync(prepared.app);
  assert.equal(app, prepared.app);
  const modules = realpathSync(resolve(app, 'node_modules'));
  assert.equal(
    modules,
    resolve(app, 'node_modules'),
    'The lane modules must be a regular own directory',
  );
  assert.equal(digest(resolve(app, 'package-lock.json')), lockSHA256);
  const lock = read(resolve(app, 'package-lock.json'));
  const require = createRequire(resolve(app, 'package.json'));
  const semverPath = realpathSync(require.resolve('semver'));
  assert.ok(inside(semverPath, modules));
  const semver = require('semver');
  assert.ok(
    semver.gte(process.versions.node, lane.nodeMinimum),
    'This lane requires Node ' + lane.nodeMinimum,
  );
  const identities = [];
  for (const [name, expected] of Object.entries(lane.versions)) {
    const packageRoot = realpathSync(resolve(modules, name));
    assert.ok(inside(packageRoot, modules), 'Foreign peer directory: ' + name);
    const manifestPath = resolve(packageRoot, 'package.json');
    const manifest = read(manifestPath);
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, expected, 'Exact lane version differs: ' + name);
    assert.equal(lock.packages['node_modules/' + name].version, expected);
    assert.ok(!manifest.engines?.node || semver.satisfies(process.version, manifest.engines.node));
    const peers = [];
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (manifest.peerDependenciesMeta?.[peer]?.optional) continue;
      // Resolve from the package declaring the peer, so a legitimate nested
      // peer is checked without substituting a flat root or repository copy.
      const resolvedPeer = peerIdentity(packageRoot, peer, modules);
      const actual = resolvedPeer.version;
      assert.ok(semver.satisfies(actual, range), name + ' required peer mismatch: ' + peer);
      peers.push({ peer, range, actual, ...resolvedPeer });
    }
    identities.push({
      name,
      version: expected,
      packageRoot,
      manifestSHA256: digest(manifestPath),
      peers,
    });
  }
  for (const receipt of lane.officialReceipts ?? []) {
    const actual = lock.packages['node_modules/' + receipt.name];
    assert.equal(actual.version, receipt.version);
    assert.equal(actual.resolved, receipt.primarySource);
    assert.equal(actual.integrity, receipt.integrity);
    const manifest = read(resolve(modules, receipt.name, 'package.json'));
    for (const [peer, range] of Object.entries(receipt.peerDependencies))
      assert.equal(manifest.peerDependencies[peer], range);
  }
  const inventory = read(prepared.inventory);
  const product = realpathSync(resolve(modules, 'payload-live-preview'));
  assert.equal(
    product,
    resolve(modules, 'payload-live-preview'),
    'The archive consumer must be a regular own package',
  );
  assert.equal(digest(prepared.vendor), prepared.archiveSHA256);
  assert.equal(inventory.sha256, prepared.archiveSHA256);
  const productManifest = read(resolve(product, 'package.json'));
  assert.equal(productManifest.version, inventory.version);
  const packedLock = lock.packages['node_modules/payload-live-preview'];
  assert.equal(packedLock.version, inventory.version);
  assert.equal(packedLock.integrity, inventory.sha512Integrity);
  assert.ok(!packedLock.link, 'The reviewed archive must not be a workspace link');
  for (const [name, expected] of Object.entries(inventory.files)) {
    assert.ok(
      lstatSync(resolve(product, name)).isFile() &&
        !lstatSync(resolve(product, name)).isSymbolicLink(),
    );
    const file = realpathSync(resolve(product, name));
    assert.ok(inside(file, product), 'Installed candidate file escaped the archive consumer');
    assert.equal(readFileSync(file).length, expected.bytes);
    assert.equal(digest(file), expected.sha256, 'Installed candidate bytes differ: ' + name);
  }
  const entries = [];
  for (const name of [
    'payload-live-preview',
    'payload-live-preview/plugin',
    'payload-live-preview/server',
    'payload-live-preview/react',
    'payload-live-preview/vue',
  ]) {
    const resolved = resolveConsumerImport(app, name);
    assert.ok(inside(resolved, product), 'Native ESM entry escaped the own archive consumer');
    const key =
      name === 'payload-live-preview' ? '.' : './' + name.slice('payload-live-preview/'.length);
    const descriptor = productManifest.exports[key];
    const optionalRequire = ['./react', './vue'].includes(key);
    assert.ok(descriptor.import, 'Required native import condition is absent');
    const targets = inventory.publicEntries[key];
    assert.equal(resolved, realpathSync(resolve(product, targets.import)));
    let requireEntry;
    if (descriptor.require !== undefined) {
      requireEntry = realpathSync(require.resolve(name));
      assert.ok(inside(requireEntry, product), 'CJS entry escaped the own archive consumer');
      assert.equal(requireEntry, realpathSync(resolve(product, targets.require)));
    } else assert.ok(optionalRequire, 'Required CJS condition is absent');
    entries.push({
      name,
      import: { path: resolved, sha256: digest(resolved) },
      require: requireEntry ? { path: requireEntry, sha256: digest(requireEntry) } : null,
    });
  }
  return {
    status: 'exact-regular-owned-lane-required-peers-and-archive-passed',
    node: process.version,
    archiveSHA256: prepared.archiveSHA256,
    payloadVersion: lane.version,
    lockSHA256,
    identities,
    entries,
    verifiedPackedFiles: Object.keys(inventory.files).length,
    sdkExecutedByResolver: false,
  };
}
