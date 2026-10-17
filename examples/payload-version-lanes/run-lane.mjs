/**
 * Run one fresh installed consumer after an explicit resource release.
 * Stages retain their first raw result, signal, timeout and owned-group close;
 * a failed lane never becomes an acceptance for another family or surface.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { source, read, digest, json, preparedContract } from './inputs.mjs';
import { boundedStages } from './shared/bounded-stage-diagnostic.mjs';
import { diagnostic } from './shared/diagnostics.mjs';
import { verifyOwnedGraph } from './owned-graph.mjs';
import { engines, v2Titles } from './plan.mjs';
import { verifyInstalledCandidate } from './v2/identity.mjs';

// What a passed v2 probe may be quoted for, and what it does not show.
const acceptance = {
  dom: {
    status: 'native-v2-dom-session-scoped-passed',
    limitation:
      'Real v2 DOM/session and chosen relationship; not native hooks, a v4 profile or the release matrix.',
  },
  lifecycle: {
    status: 'native-v2-hook-lifecycle-scoped-passed',
    limitation:
      'Real v2 native hooks, disposal, document change and iframe reload; not capacity, cross-site cookies, native Safari or the release matrix.',
  },
  population: {
    status: 'native-v2-hook-population-scoped-passed',
    limitation:
      'Real v2 native hooks fed by the admin form and relationship picker, with session gating; not lifecycle, capacity, cross-site cookies, native Safari or the release matrix.',
  },
};

function idle() {
  const result = spawnSync('ps', ['-eo', 'pid,args'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  assert.ok(!result.error);
  assert.ok(
    !/(?:@stryker-mutator\/core|\.bin\/stryker|stryker run|resume-run-nightly\.mjs)/u.test(
      result.stdout,
    ),
    'A mutation job is still active',
  );
}

export async function runLane(action, options) {
  assert.equal(
    options['resources-released'],
    true,
    'The coordinator must release this native unit explicitly',
  );
  const prepared = preparedContract(options.prepared);
  assert.equal(realpathSync(options.repo), prepared.repo);
  idle();
  const tuple = (value) => value.replace(/^v/u, '').split('.').map(Number);
  const actualNode = tuple(process.version);
  const minimumNode = tuple(prepared.laneDefinition.nodeMinimum);
  assert.ok(
    actualNode.some(
      (value, index) =>
        value > minimumNode[index] &&
        actualNode.slice(0, index).every((item, at) => item === minimumNode[at]),
    ) || actualNode.every((value, index) => value === minimumNode[index]),
    'This lane needs Node ' + prepared.laneDefinition.nodeMinimum,
  );
  if (action === 'probe') {
    assert.match(options['lock-sha256'] ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(digest(resolve(prepared.app, 'package-lock.json')), options['lock-sha256']);
    const installed = read(
      resolve(prepared.lane === 'v2' ? read(prepared.runFile).run : prepared.out, 'install.json'),
    );
    assert.equal(installed.lockSHA256 ?? installed.lockSha256, options['lock-sha256']);
    if (prepared.lane !== 'v2')
      assert.ok(!existsSync(prepared.database), 'Use a fresh own database for a native probe');
  }
  const queue = resolve(prepared.out, action);
  mkdirSync(queue, { mode: 0o700 });
  let cancellation;
  let activeStop;
  let failed;
  const atomicWrite = (path, value) => {
    const temporary = path + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  };
  const record = (value) =>
    atomicWrite(resolve(queue, 'state.json'), {
      lane: prepared.lane,
      payloadVersion: prepared.payloadVersion,
      archiveSHA256: prepared.archiveSHA256,
      sourceManifestSHA256: prepared.sourceManifestSHA256,
      pid: process.pid,
      at: new Date().toISOString(),
      ...value,
    });
  const assertNotCancelled = () => assert.ok(!cancellation, 'Lane coordinator cancelled');
  const signalHandler = (signal) => {
    cancellation ??= signal;
    activeStop?.('cancellation');
  };
  const handlers = Object.fromEntries(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => signalHandler(signal)]),
  );
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  const checkBeforeStage = () => {
    assertNotCancelled();
    preparedContract(options.prepared);
    idle();
    if (action === 'probe') {
      assert.equal(digest(resolve(prepared.app, 'package-lock.json')), options['lock-sha256']);
      if (prepared.lane === 'v2')
        verifyInstalledCandidate(
          prepared.app,
          { version: prepared.archiveVersion, sha256: prepared.archiveSHA256 },
          read(prepared.inventory),
        );
      else verifyOwnedGraph(prepared, prepared.laneDefinition, options['lock-sha256']);
    }
  };
  const stage = boundedStages({
    root: prepared.repo,
    queue,
    archive: { sha256: prepared.archiveSHA256 },
    record,
    atomicWrite,
    checkBeforeStage,
    assertNotCancelled,
    setActiveStop: (value) => {
      activeStop = value;
    },
    cancellation: () => cancellation,
  });
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
    PLP_P2_RUN_FILE: prepared.runFile,
    PLP_P2_RESOURCES_RELEASED: '1',
    PLP_R6_WORK: prepared.app,
    PLP_R6_SURFACE: prepared.surface,
    PLP_R6_ARCHIVE_SHA: prepared.archiveSHA256,
    PLP_R6_ADMIN: 'http://localhost:' + prepared.ports.admin,
    PLP_R6_FRONTEND: 'http://localhost:' + prepared.ports.frontend,
    PLP_R6_ADMIN_PORT: String(prepared.ports.admin),
    PLP_R6_FRONTEND_PORT: String(prepared.ports.frontend),
  };
  try {
    record({ status: 'running', action });
    if (action === 'install') {
      await stage(
        'strict-install',
        prepared.lane === 'v2'
          ? resolve(prepared.harness, 'install.mjs')
          : resolve(source, 'install-lane.mjs'),
        prepared.lane === 'v2' ? [] : [options.prepared],
        env,
        1_200_000,
      );
    } else if (prepared.lane === 'v2') {
      await stage(
        'native-v2-three-engines',
        resolve(prepared.harness, 'run.mjs'),
        [],
        env,
        1_500_000,
      );
      const settings = read(prepared.runFile);
      const report = read(resolve(settings.run, 'browser-results.json'));
      assert.equal(report.status, 'passed');
      assert.deepEqual(report.errors, []);
      assert.equal(report.tests.length, prepared.expectedCases);
      assert.equal(report.totals.passed, prepared.expectedCases);
      assert.equal(report.totals.skipped, 0);
      assert.equal(report.totals.failed, 0);
      assert.equal(report.candidateSha256, prepared.archiveSHA256);
      assert.equal(report.variant, prepared.variant);
      const titles = v2Titles(prepared.laneDefinition, prepared.probe);
      for (const browser of engines) {
        const tests = report.tests.filter((test) => test.project === browser);
        assert.equal(tests.length, titles.length);
        assert.deepEqual(tests.map((test) => test.title).sort(), [...titles].sort());
        for (const test of tests) {
          assert.equal(test.status, 'passed');
          assert.equal(test.expectedStatus, 'passed');
          assert.equal(test.retry, 0);
          assert.deepEqual(test.errors, []);
        }
      }
      const identity = read(resolve(settings.run, 'identity.json'));
      assert.equal(identity.dependencyLockSha256, options['lock-sha256']);
      assert.equal(identity.candidate.sha256, prepared.archiveSHA256);
      const audit = read(resolve(settings.run, 'credential-audit.json'));
      assert.deepEqual(audit.findings, []);
      json(resolve(queue, 'accepted-v2.json'), {
        status: acceptance[prepared.probe].status,
        expectedCases: prepared.expectedCases,
        surface: prepared.surface,
        archiveSHA256: prepared.archiveSHA256,
        variant: prepared.variant,
        browserReportSHA256: digest(resolve(settings.run, 'browser-results.json')),
        limitation: acceptance[prepared.probe].limitation,
      });
    } else {
      await stage(
        'own-compiler-and-initial-ssr',
        resolve(prepared.harness, 'build-consumer.mjs'),
        ['--prepared=' + options.prepared, '--lock-sha256=' + options['lock-sha256']],
        env,
        120_000,
      );
      await stage(
        'native-' + prepared.probe + '-three-engines',
        resolve(prepared.app, 'node_modules/@playwright/test/cli.js'),
        ['test', '--config', resolve(prepared.harness, 'lifecycle.config.mjs')],
        env,
        1_500_000,
      );
      if (prepared.probe === 'wire')
        await stage(
          'exact-wire-result',
          resolve(prepared.harness, 'verify-wire.mjs'),
          [options.prepared],
          env,
          30_000,
        );
      else
        await stage(
          'exact-lifecycle-result',
          resolve(prepared.harness, 'verify-result-diagnostic.mjs'),
          [
            '--work=' + prepared.app,
            '--surface=' + prepared.surface,
            '--sha256=' + prepared.archiveSHA256,
          ],
          env,
          30_000,
        );
      await stage(
        'actual-wire-shape-review',
        resolve(prepared.harness, 'wire-review.mjs'),
        [prepared.app],
        env,
        30_000,
      );
    }
    checkBeforeStage();
    record({
      status:
        action === 'install'
          ? 'passed-install-review-lock-before-probe'
          : 'passed-scoped-native-profile-review-required',
      action,
    });
  } catch (error) {
    failed = true;
    record({
      status: cancellation ? 'cancelled' : 'stopped-on-first-failure',
      action,
      cancellation: cancellation ?? null,
      error: diagnostic(error),
      noAutomaticRerun: true,
    });
  } finally {
    for (const [signal, handler] of Object.entries(handlers))
      process.removeListener(signal, handler);
    writeFileSync(
      resolve(queue, 'gate.exit'),
      String(cancellation ? (cancellation === 'SIGTERM' ? 143 : 130) : failed ? 1 : 0) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  return {
    status: read(resolve(queue, 'state.json')).status,
    queue,
    gateExit: Number(readFileSync(resolve(queue, 'gate.exit'), 'utf8')),
  };
}
