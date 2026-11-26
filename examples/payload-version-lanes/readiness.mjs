/**
 * Inspect the planned lane and exact discovery without executing its runtime.
 * Listing uses reviewed repository test tooling only; no installed SDK, database
 * or browser outcome is inferred from the resulting case titles.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { source, read, json, sourceContract, preparedContract } from './inputs.mjs';

const engines = ['chromium', 'firefox', 'webkit'];

export function listLanes() {
  const { definition, manifestSHA256, inputs } = sourceContract();
  return {
    status: 'portable-source-contract-passed-native-not-executed',
    sourceManifestSHA256: manifestSHA256,
    sourceInputs: inputs,
    lanes: Object.fromEntries(
      Object.entries(definition.lanes).map(([key, lane]) => [
        key,
        {
          payloadVersion: lane.version,
          nodeMinimum: lane.nodeMinimum,
          admin: lane.admin,
          exactVersions: lane.versions,
          ports: lane.ports,
          officialSources: lane.officialReceipts ?? [],
          scope: lane.scope,
        },
      ]),
    ),
    v4Profile: definition.v4ProfileDecision,
  };
}

export function discoverLane(options) {
  const prepared = preparedContract(options.prepared);
  assert.equal(realpathSync(options.repo), prepared.repo);
  const tool = resolve(prepared.repo, 'node_modules/@playwright/test');
  assert.equal(read(resolve(tool, 'package.json')).version, '1.62.1');
  const env = {
    ...process.env,
    NODE_PATH: '',
    NODE_OPTIONS: '',
    DEBUG: '',
    PWDEBUG: '',
    PW_TEST_REPORTER: '',
    PLP_VERSION_LANES_REPO: prepared.repo,
    PLP_VERSION_LANE_PREPARED: options.prepared,
    PLP_VERSION_LANE_VERSION: prepared.payloadVersion,
  };
  const config = resolve(source, 'discovery.config.mjs');
  const result = spawnSync(
    process.execPath,
    [resolve(tool, 'cli.js'), 'test', '--config', config, '--list', '--reporter=json'],
    {
      cwd: prepared.repo,
      env,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  writeFileSync(resolve(prepared.out, 'discovery.stdout.json'), result.stdout ?? '', {
    flag: 'wx',
    mode: 0o600,
  });
  writeFileSync(resolve(prepared.out, 'discovery.stderr.log'), result.stderr ?? '', {
    flag: 'wx',
    mode: 0o600,
  });
  json(resolve(prepared.out, 'discovery-process.json'), {
    rawExit: result.status,
    signal: result.signal,
    error: result.error ? { name: result.error.name, code: result.error.code } : null,
    runtimeExecuted: false,
    timeoutMs: 30_000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.ok(!result.error);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  assert.equal(report.config.webServer, null);
  assert.equal(report.config.projects.length, engines.length);
  assert.ok(
    report.config.projects.every((project) => project.retries === 0 && project.repeatEach === 1),
  );
  const cases = [];
  function collect(suite) {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests) {
        assert.deepEqual(test.results, []);
        cases.push({ file: spec.file, title: spec.title, project: test.projectName });
      }
    for (const nested of suite.suites ?? []) collect(nested);
  }
  for (const suite of report.suites) collect(suite);
  assert.equal(cases.length, prepared.expectedCases);
  assert.equal(new Set(cases.map((item) => item.project + ':' + item.title)).size, cases.length);
  for (const browser of engines)
    assert.equal(
      cases.filter((item) => item.project === browser).length,
      prepared.expectedCases / engines.length,
    );
  // A cell runs one spec.
  assert.deepEqual(
    [...new Set(cases.map((item) => item.file))],
    [prepared.probe === 'wire' ? 'wire.spec.mjs' : 'lifecycle.diagnostic.spec.mjs'],
  );
  const receipt = {
    status: 'exact-discovery-passed-native-not-executed',
    lane: prepared.lane,
    payloadVersion: prepared.payloadVersion,
    archiveSHA256: prepared.archiveSHA256,
    sourceManifestSHA256: prepared.sourceManifestSHA256,
    expectedCases: prepared.expectedCases,
    cases,
    browserStarted: false,
    serverStarted: false,
    installedSDKExecuted: false,
  };
  json(resolve(prepared.out, 'discovery-result.json'), receipt);
  return receipt;
}
