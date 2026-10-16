/**
 * Accept only all four native lifecycle cases in all three requested engines.
 * Identity and bounded observation files must accompany the exact retained
 * archive; this checker does not relabel the gate as production/floor evidence.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const options = Object.fromEntries(
  process.argv.slice(2).map((value) => {
    const split = value.indexOf('=');
    assert.ok(split > 2, 'Use --work= --surface= --sha256=');
    return [value.slice(2, split), value.slice(split + 1)];
  }),
);
assert.deepEqual(Object.keys(options).sort(), ['sha256', 'surface', 'work']);
assert.ok(isAbsolute(options.work) && ['react', 'vue'].includes(options.surface));
assert.match(options.sha256, /^[a-f0-9]{64}$/u);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const identity = JSON.parse(await readFile(resolve(options.work, 'identity.json'), 'utf8'));
assert.equal(identity.archive.sha256, options.sha256);
assert.equal(hash(await readFile(identity.archive.path)), options.sha256, 'Retained archive drift');
const reportPath = resolve(options.work, 'playwright-' + options.surface + '.json');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.archiveSHA256, options.sha256);
assert.equal(report.surface, options.surface);
assert.equal(report.status, 'passed');
assert.deepEqual(report.errors, []);
assert.equal(report.tests.length, 12);
const titles = [
  'native SSR hydrates without recovery errors and actual editor traffic populates its relationship',
  'native unmount or scope disposal aborts held REST work and a replacement accepts the next real edit',
  'changing the real admin document creates a fresh native consumer for the other global',
  'receiver changes retire the original target and refuse a same-origin foreign sender',
];
const observations = [
  'actual-admin-ssr-edit',
  'actual-admin-native-stop-restart',
  'actual-admin-document-change',
  'native-receiver-source-counterchecks',
];
const artifacts = [{ path: reportPath, sha256: hash(await readFile(reportPath)) }];
for (const browser of ['chromium', 'firefox', 'webkit']) {
  const tests = report.tests.filter((test) => test.project === browser);
  assert.equal(tests.length, 4);
  assert.deepEqual(tests.map((test) => test.title).sort(), [...titles].sort());
  for (const test of tests) {
    assert.equal(test.status, 'passed');
    assert.equal(test.expectedStatus, 'passed');
    assert.equal(test.outcome, 'expected');
    assert.equal(test.retry, 0);
    assert.equal(test.repeatEachIndex, 0);
    assert.deepEqual(test.errors, []);
    assert.ok(!test.annotations.some((type) => ['skip', 'fixme', 'fail'].includes(type)));
  }
  for (const phase of [
    'after-target-control',
    'after-retired-delivery',
    'after-replay-delivery',
    'finally',
  ]) {
    const path = resolve(
      options.work,
      'observations',
      browser,
      'receiver-diagnostic-' + phase + '.json',
    );
    const raw = await readFile(path);
    assert.ok(raw.length <= 512 * 1024 + 4096, 'Bounded receiver diagnostic grew unexpectedly');
    const checkpoint = JSON.parse(raw);
    assert.equal(checkpoint.archiveSHA256, options.sha256);
    assert.equal(checkpoint.surface, options.surface);
    assert.equal(checkpoint.browser.name, browser);
    assert.equal(checkpoint.diagnosticOnly, true);
    assert.equal(checkpoint.phase, phase);
    assert.equal(checkpoint.capturedNow, true, 'A fallback cannot certify fresh delivery');
    assert.ok(checkpoint.observed.ingress && checkpoint.observed.rest && checkpoint.observed.dom);
    assert.ok(
      checkpoint.observed.activeSession?.observation ===
        'native-' + options.surface + '-public-snapshot',
    );
    artifacts.push({ path, sha256: hash(raw) });
  }
  for (const name of observations) {
    const path = resolve(options.work, 'observations', browser, name + '.json');
    const raw = await readFile(path);
    const observation = JSON.parse(raw);
    assert.equal(observation.archiveSHA256, options.sha256);
    assert.equal(observation.surface, options.surface);
    assert.equal(observation.browser.name, browser);
    assert.ok(
      typeof observation.browser.version === 'string' && observation.browser.version.length > 0,
    );
    for (const ledger of [
      observation.proof,
      observation.before,
      observation.after,
      observation.afterRetired,
      observation.beforeForeign,
    ].filter(Boolean)) {
      assert.deepEqual(ledger.validationErrors, []);
      assert.deepEqual(ledger.hydrationErrors, []);
    }
    if (options.surface === 'react' && name === 'actual-admin-native-stop-restart') {
      assert.ok(observation.proof.strictSetups - observation.beforeRestart.strictSetups >= 2);
      assert.ok(observation.proof.strictCleanups - observation.beforeRestart.strictCleanups >= 1);
    }
    artifacts.push({ path, sha256: hash(raw) });
  }
}
const result = {
  schemaVersion: 1,
  status: 'bounded-native-lifecycle-passed',
  surface: options.surface,
  archiveSHA256: options.sha256,
  expectedCases: 12,
  retries: 0,
  skips: 0,
  artifacts,
  identitySHA256: hash(await readFile(resolve(options.work, 'identity.json'))),
  scope: identity.scope,
  limitation:
    'Developmental native React/Vue with this exact isolated Payload family and own regular dependency graph. No optimized framework/floor, another family, or entire H19 closure.',
};
await writeFile(
  resolve(options.work, 'accepted-' + options.surface + '.json'),
  JSON.stringify(result, null, 2) + '\n',
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
