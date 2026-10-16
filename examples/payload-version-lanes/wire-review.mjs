/**
 * Classify bounded metadata from the actual parent admin's message stream.
 * A package version never chooses a protocol profile, and the previous canary33
 * corpus cannot certify the current canary37; a production profile awaits review.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const work = resolve(process.argv[2]);
assert.equal(process.argv.length, 3);
const prepared = JSON.parse(readFileSync(resolve(work, '..', 'prepared.json'), 'utf8'));
const observations = [];
for (const browser of ['chromium', 'firefox', 'webkit']) {
  const directory = resolve(work, 'observations', browser);
  for (const name of readdirSync(directory).filter((file) => file.startsWith('wire-shape-'))) {
    const value = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
    assert.equal(value.archiveSHA256, prepared.archiveSHA256);
    assert.equal(value.payloadVersion, prepared.payloadVersion);
    assert.ok(
      value.rows.length <= 128 &&
        value.rows.every((row) => row.parentSource && row.keys.length <= 24),
    );
    observations.push({ browser, file: name, rows: value.rows });
  }
}
assert.ok(
  observations.length > 0 && observations.some((item) => item.rows.length > 0),
  'A protocol profile requires actual wire observation',
);
const rows = observations.flatMap((item) => item.rows);
const schema = rows.some((row) => row.schemaJSON);
const schemaRepresentations = [
  ...new Set(rows.filter((row) => row.schemaJSON).map((row) => row.schemaShape)),
].sort();
const documentEvents = rows.some((row) => row.type === 'payload-document-event');
const relationshipEvents = rows.some((row) => row.relationshipEvent);
const result = {
  status: 'actual-wire-shape-characterized-profile-review-required',
  payloadLane: prepared.lane,
  payloadVersion: prepared.payloadVersion,
  archiveSHA256: prepared.archiveSHA256,
  observations,
  observedFeatures: {
    schemaJSON: schema,
    schemaRepresentations,
    documentEvents,
    relationshipEvents,
  },
  classificationFromActualWire: schema
    ? 'schema-bearing-wire'
    : documentEvents || relationshipEvents
      ? 'document-or-relationship-event-wire'
      : 'unknown-wire',
  productionProfileChanged: false,
  canary33UsedAsCanary37Evidence: false,
  limitation:
    'Bounded credential-free shape metadata, not the complete immutable protocol corpus or a public v4 support claim.',
};
writeFileSync(resolve(work, 'wire-review.json'), JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
console.log(
  JSON.stringify({
    status: result.status,
    payloadVersion: prepared.payloadVersion,
    messages: rows.length,
    classificationFromActualWire: result.classificationFromActualWire,
  }),
);
