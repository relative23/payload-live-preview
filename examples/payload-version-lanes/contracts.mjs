/**
 * Observe real ledger entry points using only controlled public fixture shapes.
 * Array/string/absent schemas and receiver/source bounds are checked separately
 * from a version declaration; these contracts confer no native protocol proof.
 */
import assert from 'node:assert/strict';
import { ledger, observeInbox, schemaShape } from './frontend/ledger.mjs';
import { sourceContract } from './inputs.mjs';

const result = sourceContract();
const original = globalThis.window;
const cases = [];
try {
  for (const [shape, value] of [
    ['array', [{ name: 'title', type: 'text' }]],
    ['string', '[{"name":"title"}]'],
    ['absent', undefined],
    ['other', { name: 'title' }],
  ]) {
    globalThis.window = {};
    const parent = {};
    const listeners = [];
    const target = { parent, addEventListener: (_type, listener) => listeners.push(listener) };
    observeInbox(target, 'primary', 'http://localhost:4572');
    const data = {
      type: 'payload-live-preview',
      data: { title: 'Public fixture marker' },
      globalSlug: 'homepage',
      ...(value === undefined ? {} : { fieldSchemaJSON: value }),
    };
    listeners[0]({ origin: 'http://localhost:4572', source: parent, data });
    const rows = ledger().wireMetadata;
    assert.equal(schemaShape(value), shape);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].schemaShape, shape);
    assert.equal(rows[0].schemaJSON, ['array', 'string'].includes(shape));
    assert.ok(!Object.hasOwn(rows[0], 'fieldSchemaJSON') && !Object.hasOwn(rows[0], 'data'));
    cases.push('schema-' + shape + '-metadata-without-schema-values-or-version-grant');
  }
  globalThis.window = {};
  const parent = {};
  const listeners = [];
  const target = { parent, addEventListener: (_type, listener) => listeners.push(listener) };
  observeInbox(target, 'primary', 'http://localhost:4572');
  observeInbox(target, 'primary', 'http://localhost:4572');
  assert.equal(listeners.length, 1);
  const data = {
    type: 'payload-document-event',
    fieldSchemaJSON: [],
    externallyUpdatedRelationship: { credential: 'must not be retained' },
  };
  listeners[0]({ origin: 'http://localhost:4572', source: {}, data });
  listeners[0]({ origin: 'http://unlisted.invalid', source: parent, data });
  assert.equal(ledger().wireMetadata.length, 0);
  for (let index = 0; index < 140; index++)
    listeners[0]({ origin: 'http://localhost:4572', source: parent, data });
  assert.equal(ledger().wireMetadata.length, 128);
  assert.ok(ledger().wireMetadata.every((row) => row.parentSource && row.relationshipEvent));
  assert.ok(!JSON.stringify(ledger().wireMetadata).includes('must not be retained'));
  cases.push(
    'same-receiver-listener-identity',
    'foreign-parent-and-origin-refused',
    'bounded-parent-source-message-count',
    'relationship-event-values-withheld',
  );
} finally {
  if (original === undefined) delete globalThis.window;
  else globalThis.window = original;
}
console.log(
  JSON.stringify({
    status: 'portable-source-and-ledger-contracts-passed',
    cases,
    sourceManifestSHA256: result.manifestSHA256,
    actualNativeWire: false,
  }),
);
