/**
 * Accept only one saved-document characterization in each requested engine.
 * Actual messages and a populated saved read accompany the exact archive;
 * pre-release observations require profile review and confer no stable support.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

assert.equal(process.argv.length, 3);
const prepared = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const work = prepared.app;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const reportPath = resolve(work, 'playwright-' + prepared.surface + '.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.status, 'passed');
assert.equal(report.archiveSHA256, prepared.archiveSHA256);
assert.deepEqual(report.errors, []);
assert.equal(report.tests.length, 3);
const artifacts = [{ path: reportPath, sha256: hash(readFileSync(reportPath)) }];
for (const browser of ['chromium', 'firefox', 'webkit']) {
  const rows = report.tests.filter((test) => test.project === browser);
  assert.equal(rows.length, 1);
  const test = rows[0];
  assert.equal(
    test.title,
    'actual saved-document and relationship wire is characterized without version-derived protocol grants',
  );
  assert.equal(test.status, 'passed');
  assert.equal(test.expectedStatus, 'passed');
  assert.equal(test.outcome, 'expected');
  assert.equal(test.retry, 0);
  assert.equal(test.repeatEachIndex, 0);
  assert.deepEqual(test.errors, []);
  assert.ok(!test.annotations.some((type) => ['skip', 'fixme', 'fail'].includes(type)));
  const path = resolve(work, 'observations', browser, 'wire-shape-saved-document.json');
  const bytes = readFileSync(path);
  assert.ok(bytes.length <= 256 * 1024);
  const observation = JSON.parse(bytes);
  assert.equal(observation.archiveSHA256, prepared.archiveSHA256);
  assert.equal(observation.payloadVersion, prepared.payloadVersion);
  assert.equal(observation.browser, browser);
  assert.equal(observation.credentialValuesRetained, false);
  assert.ok(observation.rows.length > 0 && observation.rows.length <= 128);
  assert.ok(observation.rows.every((row) => row.parentSource));
  assert.ok(observation.rows.some((row) => row.type === 'payload-document-event'));
  artifacts.push({ path, sha256: hash(bytes) });
}
const identity = JSON.parse(readFileSync(resolve(work, 'identity.json'), 'utf8'));
assert.equal(identity.payloadVersion, prepared.payloadVersion);
assert.equal(identity.archive.sha256, prepared.archiveSHA256);
const result = {
  status: 'native-saved-wire-characterized-profile-review-required',
  payloadLane: prepared.lane,
  payloadVersion: prepared.payloadVersion,
  archiveSHA256: prepared.archiveSHA256,
  expectedCases: 3,
  retries: 0,
  skips: 0,
  artifacts,
  productionProfileChanged: false,
  limitation:
    'Actual developmental saved-wire metadata, not a complete corpus, lifecycle union, floor or public v4 support proof.',
};
writeFileSync(resolve(work, 'accepted-wire.json'), JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  JSON.stringify({ status: result.status, payloadVersion: prepared.payloadVersion, cases: 3 }),
);
