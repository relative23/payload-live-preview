/**
 * Copy one exact lane into a new directory without installing or starting it.
 * v3 and v4 have separate regular Next consumers, SQLite identities and
 * portable official registry receipts.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { source, digest, json, regularFiles, sourceContract, freshOutput } from './inputs.mjs';

export function prepareLane(options) {
  const { definition, manifestSHA256 } = sourceContract();
  const lane = definition.lanes[options.lane];
  assert.ok(lane, '--lane must be v3 or v4');
  assert.ok(isAbsolute(options.repo) && isAbsolute(options.tarball));
  const repo = realpathSync(options.repo);
  const archive = realpathSync(options.tarball);
  assert.match(options.sha256 ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(digest(archive), options.sha256, 'Selected archive digest differs');
  const inspection = spawnSync('python3', [resolve(source, 'archive-inspect.py'), archive], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(inspection.status, 0);
  assert.equal(inspection.signal, null);
  assert.ok(!inspection.error);
  const inventory = JSON.parse(inspection.stdout);
  assert.equal(inventory.sha256, options.sha256);
  const surface = options.surface ?? 'react';
  const probe = options.probe ?? 'lifecycle';
  assert.ok(['react', 'vue'].includes(surface) && ['lifecycle', 'wire'].includes(probe));
  const out = freshOutput(options.out);
  mkdirSync(out, { mode: 0o700 });
  const app = resolve(out, 'app');
  mkdirSync(app, { mode: 0o700 });
  cpSync(resolve(source, 'admin'), resolve(app, 'cms'), { recursive: true });
  cpSync(resolve(source, 'frontend'), resolve(app, 'frontend'), { recursive: true });
  cpSync(
    resolve(source, 'frontend/payload.config.ts.fixture'),
    resolve(app, 'cms/payload.config.ts'),
  );
  const harness = resolve(app, 'harness');
  cpSync(resolve(source, 'shared'), harness, { recursive: true });
  mkdirSync(resolve(harness, 'shared'));
  cpSync(
    resolve(source, 'shared/resolve-consumer-import.mjs'),
    resolve(harness, 'shared/resolve-consumer-import.mjs'),
  );
  for (const file of [
    'owned-graph.mjs',
    'build-consumer.mjs',
    'lifecycle.config.mjs',
    'wire.spec.mjs',
    'wire-review.mjs',
    'verify-wire.mjs',
  ]) {
    cpSync(resolve(source, file), resolve(harness, file));
  }
  const manifest = {
    name: 'plp-' + options.lane + '-isolated-admin-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: 'npm@12.0.2',
    engines: { node: '>=' + lane.nodeMinimum },
    dependencies: {
      ...lane.versions,
      'payload-live-preview': 'file:./vendor/payload-live-preview.tgz',
    },
    allowScripts: { 'esbuild@0.28.2': true, 'esbuild@0.25.12': true, 'fsevents@2.3.3': false },
  };
  json(resolve(app, 'package.json'), manifest);
  json(resolve(app, 'cms/package.json'), {
    name: 'plp-' + options.lane + '-admin',
    private: true,
    type: 'module',
  });
  json(resolve(app, 'frontend/package.json'), {
    name: 'plp-' + options.lane + '-frontend',
    private: true,
    type: 'module',
  });
  writeFileSync(
    resolve(app, '.npmrc'),
    'engine-strict=true\nstrict-peer-deps=true\ninstall-links=true\n',
    { flag: 'wx', mode: 0o600 },
  );
  mkdirSync(resolve(app, 'vendor'));
  cpSync(archive, resolve(app, 'vendor/payload-live-preview.tgz'));
  json(resolve(out, 'archive-inventory.json'), inventory);
  let prepared = {
    app,
    harness,
    inventory: resolve(out, 'archive-inventory.json'),
    vendor: resolve(app, 'vendor/payload-live-preview.tgz'),
    database: resolve(
      app,
      'cms',
      'lane_' + options.lane + '_' + randomBytes(12).toString('hex') + '.db',
    ),
  };

  const generated = 'app/cms/src/app/(payload)/admin/importMap.js';
  const materializedInputs = regularFiles(out)
    .filter((file) => relative(out, file) !== generated)
    .map((file) => ({ path: relative(out, file), sha256: digest(file) }));
  prepared = {
    schemaVersion: 1,
    status: 'prepared-only-not-installed-not-native-executed',
    lane: options.lane,
    payloadVersion: lane.version,
    laneDefinition: lane,
    surface,
    probe,
    out,
    repo,
    ports: lane.ports,
    expectedCases: probe === 'wire' ? 3 : 12,
    archiveSource: archive,
    archiveSHA256: options.sha256,
    archiveVersion: inventory.version,
    sourceManifestSHA256: manifestSHA256,
    materializedInputs,
    generatedOutputExcludedFromInputFreeze: [generated],
    preparedAt: new Date().toISOString(),
    observedNode: process.version,
    ...prepared,
  };
  json(resolve(out, 'prepared.json'), prepared);
  json(resolve(out, 'prepared-identity.json'), { sha256: digest(resolve(out, 'prepared.json')) });
  return {
    status: prepared.status,
    lane: options.lane,
    payloadVersion: lane.version,
    surface,
    probe,
    prepared: resolve(out, 'prepared.json'),
    database: prepared.database,
    ports: prepared.ports,
    archiveSHA256: prepared.archiveSHA256,
    sourceManifestSHA256: manifestSHA256,
    expectedCases: prepared.expectedCases,
  };
}
