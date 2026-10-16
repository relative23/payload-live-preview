/**
 * Retain portable source and materialized-input identities for every lane.
 * A prepared consumer has one archive and fresh directory; later installation
 * cannot silently replace the selected family, templates or original sources.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const source = dirname(fileURLToPath(import.meta.url));
export const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const inside = (path, parent) => path.startsWith(parent + sep);
export const json = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

export function regularFiles(directory) {
  const files = [];
  function visit(path) {
    assert.ok(!lstatSync(path).isSymbolicLink(), 'Source/input links are refused');
    if (lstatSync(path).isDirectory())
      for (const name of readdirSync(path).sort()) visit(resolve(path, name));
    else {
      assert.ok(lstatSync(path).isFile());
      files.push(path);
    }
  }
  visit(directory);
  return files;
}

export function sourceContract() {
  const manifestPath = resolve(source, 'source-manifest.json');
  const manifest = read(manifestPath);
  assert.equal(manifest.schemaVersion, 1);
  const actual = regularFiles(source)
    .filter((path) => path !== manifestPath)
    .map((path) => relative(source, path));
  assert.deepEqual(
    actual.sort(),
    Object.keys(manifest.files).sort(),
    'Portable source set changed',
  );
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.ok(!isAbsolute(name) && !name.split(/[\\/]/u).includes('..'));
    const path = realpathSync(resolve(source, name));
    assert.ok(inside(path, source));
    assert.equal(digest(path), expected.sha256, 'Portable source bytes changed: ' + name);
  }
  const definition = read(resolve(source, 'lanes.json'));
  for (const lane of Object.values(definition.lanes))
    for (const receipt of lane.officialReceipts ?? []) {
      const path = resolve(source, receipt.receiptSource);
      assert.equal(digest(path), receipt.receiptSHA256);
      const rows = read(path);
      assert.equal(rows.length, 1, 'Official npm12 receipt must contain one exact result');
      assert.equal(rows[0].version, receipt.version);
      assert.deepEqual(rows[0].peerDependencies, receipt.peerDependencies);
      assert.equal(rows[0]['dist.tarball'], receipt.primarySource);
      assert.equal(rows[0]['dist.integrity'], receipt.integrity);
      assert.equal(rows[0].engines?.node ?? null, receipt.nodeEngine);
    }
  return { definition, manifestSHA256: digest(manifestPath), inputs: actual.length };
}

export function preparedContract(path) {
  assert.ok(isAbsolute(path));
  const prepared = read(realpathSync(path));
  const current = sourceContract();
  assert.equal(current.manifestSHA256, prepared.sourceManifestSHA256);
  assert.deepEqual(prepared.laneDefinition, current.definition.lanes[prepared.lane]);
  assert.equal(realpathSync(prepared.out), prepared.out);
  assert.equal(realpathSync(path), resolve(prepared.out, 'prepared.json'));
  assert.equal(digest(path), read(resolve(prepared.out, 'prepared-identity.json')).sha256);
  assert.ok(inside(realpathSync(prepared.app), prepared.out));
  assert.equal(digest(prepared.vendor), prepared.archiveSHA256);
  assert.equal(read(prepared.inventory).sha256, prepared.archiveSHA256);
  for (const input of prepared.materializedInputs) {
    const file = realpathSync(resolve(prepared.out, input.path));
    assert.ok(inside(file, prepared.out));
    assert.equal(digest(file), input.sha256, 'Prepared lane input drift: ' + input.path);
  }
  return prepared;
}

export function freshOutput(input) {
  assert.ok(isAbsolute(input), '--out must be absolute');
  const parent = realpathSync(dirname(input));
  const path = resolve(parent, relative(dirname(input), input));
  assert.equal(path, resolve(input), '--out parent must be a regular directory');
  assert.ok(
    path !== source && !inside(path, source),
    'Keep runtime output outside the portable source tree',
  );
  assert.ok(!existsSync(path), 'Output exists; use a fresh label and preserve its first result');
  return path;
}
