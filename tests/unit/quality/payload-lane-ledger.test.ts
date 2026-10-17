/**
 * The Payload 2 lane reads every native case from one record the preview page keeps about its own
 * hook: the admin's messages, the owners and their reads, and checkpoints named by the specs. These
 * cases hold that record to what the specs rely on: a message from a stranger leaves no row, an
 * owner knows whether it started from its own seed before any message, an aborted read keeps its
 * order, an error leaves a count and no text, and the exported record can cross the browser's
 * clone. The module runs in its own Node process against a minimal window, as the page would.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LEDGER = resolve(
  import.meta.dirname,
  '../../../examples/payload-version-lanes/v2/native/ledger.mjs',
);

interface Call {
  readonly authorPopulation: boolean;
  readonly method: string;
  readonly aborted: boolean;
  readonly abortSeq: number | null;
  readonly status: number | null;
  readonly threw: boolean;
  readonly settledSeq: number | null;
}

interface Witness {
  readonly sequence: number;
  readonly owners: readonly Record<string, unknown>[];
  readonly traffic: readonly Record<string, unknown>[];
  readonly calls: readonly Call[];
  readonly phases: readonly Record<string, unknown>[];
  readonly hydrationErrorCount: number;
  readonly validationErrorCount: number;
}

interface Outcome {
  readonly noWindow: { readonly ledger: unknown; readonly owner: unknown };
  readonly shapes: readonly unknown[];
  readonly afterStrangers: Witness;
  readonly owners: Witness;
  readonly aborted: Witness;
  readonly checkpoints: {
    readonly known: unknown;
    readonly unknown: unknown;
    readonly witness: Witness;
  };
  readonly errors: { readonly text: string; readonly witness: Witness };
  readonly bound: Witness;
}

const PROGRAM = `
import { pathToFileURL } from 'node:url';
const ADMIN = 'http://admin.test:4570';
const listeners = [];
const parent = {};
const { beginOwner, connection, installControls, ledger, observeSnapshot } = await import(
  pathToFileURL(process.env.PLP_LEDGER).href
);
const noWindow = { ledger: ledger(), owner: beginOwner('react', 'homepage', 1, {}) };
globalThis.window = {
  parent,
  addEventListener: (type, fn) => listeners.push([type, fn]),
  removeEventListener: (type, fn) => {
    const at = listeners.findIndex(([t, f]) => t === type && f === fn);
    if (at >= 0) listeners.splice(at, 1);
  },
};
const post = (data, init = {}) => {
  const event = { origin: init.origin ?? ADMIN, source: init.source ?? parent, data };
  for (const [type, fn] of listeners) if (type === 'message') fn(event);
};
const message = (extra = {}) => ({ type: 'payload-live-preview', data: { title: 'T' }, ...extra });
const witness = () => window.__r6Witness.export();
installControls(ADMIN);

const shapes = [];
for (const schema of [[{ name: 'title' }], '[]', undefined, { name: 'title' }]) {
  post(message(schema === undefined ? {} : { fieldSchemaJSON: schema }));
  shapes.push(witness().traffic.at(-1).schemaShape);
}
const before = witness().traffic.length;
post(message(), { origin: 'http://stranger.test' });
post(message(), { source: {} });
post({ type: 'payload-live-preview' });
post(message({ globalSlug: 'homepage' }));
const afterStrangers = witness();
if (afterStrangers.traffic.length !== before) throw new Error('a stranger left a row');

const seed = { title: 'seed' };
const first = beginOwner('react', 'homepage', 1, seed);
observeSnapshot(first, { data: seed, revision: 0, status: 'idle', isLoading: true, error: undefined }, 'render');
const second = beginOwner('react', 'homepage', 2, seed);
post(message());
observeSnapshot(second, { data: seed, revision: 0, status: 'idle', isLoading: true, error: undefined }, 'render');
const third = beginOwner('react', 'homepage', 3, seed);
observeSnapshot(third, { data: { title: 'seed' }, revision: 0, status: 'idle', isLoading: true, error: undefined }, 'render');
const owners = witness();

const controller = new AbortController();
globalThis.fetch = (input, init) => new Promise((resolve, reject) => {
  if (String(input).includes('answered')) return resolve({ status: 200 });
  init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
});
const owner = beginOwner('vue', 'homepage', 1, seed);
const { fetchFn } = connection(ADMIN, undefined, owner);
await fetchFn('http://admin.test:4570/api/authors?where[id][in]=1,answered', {});
const held = fetchFn('http://admin.test:4570/api/authors?where[id][in]=2', { signal: controller.signal });
controller.abort();
await held.catch(() => undefined);
await fetchFn('http://admin.test:4570/api/globals/homepage?answered', { method: 'POST' });
await connection(ADMIN, undefined, null).fetchFn('http://admin.test:4570/api/authors?answered');
const aborted = witness();

const known = window.__r6Witness.checkpoint('final');
const unknown = window.__r6Witness.checkpoint('somewhere else');
const checkpoints = { known, unknown, witness: witness() };

window.__r6.hydrationErrors.push('secret text');
const errors = { text: JSON.stringify(witness()), witness: witness() };

for (let index = 0; index < 250; index += 1) post(message());
const bound = witness();
console.log(JSON.stringify({ noWindow, shapes, afterStrangers, owners, aborted, checkpoints, errors, bound }));
`;

function run(): Outcome {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PLP_LEDGER: LEDGER },
  });
  return JSON.parse(stdout) as Outcome;
}

describe('Payload 2 lane receiver record', () => {
  const outcome = run();

  it('keeps no record outside a browser window', () => {
    expect(outcome.noWindow).toEqual({ ledger: null, owner: null });
  });

  it('names the schema of a message by its shape and keeps no schema value', () => {
    expect(outcome.shapes).toEqual(['array', 'string', 'absent', 'other']);
    expect(JSON.stringify(outcome.afterStrangers.traffic)).not.toContain('title');
  });

  it('leaves no row for a stranger, a message without data or an unexpected key', () => {
    // The unexpected key counts as a validation error, so a case can refuse it in its after-hook.
    expect(outcome.afterStrangers.traffic).toHaveLength(4);
    expect(outcome.afterStrangers.validationErrorCount).toBe(1);
  });

  it('tells an owner that started from its own seed before any message from one that did not', () => {
    const [first, second, third] = outcome.owners.owners;
    expect(first).toMatchObject({ initialOwnData: true, initialBeforeIngress: true });
    expect(second).toMatchObject({ initialOwnData: true, initialBeforeIngress: false });
    expect(third).toMatchObject({ initialOwnData: false });
  });

  it('keeps an aborted read, an answered read and a write in the order they happened', () => {
    const [answered, held, write] = outcome.aborted.calls;
    expect(answered).toMatchObject({ authorPopulation: true, status: 200, aborted: false });
    expect(held).toMatchObject({
      authorPopulation: true,
      aborted: true,
      status: null,
      threw: true,
    });
    expect(Number(held?.abortSeq)).toBeLessThan(Number(held?.settledSeq));
    expect(write).toMatchObject({ authorPopulation: false, method: 'POST' });
    // The call of a hook without an owner is delegated and leaves no row.
    expect(outcome.aborted.calls).toHaveLength(3);
  });

  it('accepts only the checkpoints the specs name', () => {
    expect(typeof outcome.checkpoints.known).toBe('number');
    expect(outcome.checkpoints.unknown).toBeNull();
    expect(outcome.checkpoints.witness.phases).toEqual([
      { phase: 'final', seq: outcome.checkpoints.known },
    ]);
    expect(outcome.checkpoints.witness.validationErrorCount).toBe(
      outcome.aborted.validationErrorCount + 1,
    );
  });

  it('exports an error as a count and no text', () => {
    expect(outcome.errors.witness.hydrationErrorCount).toBe(1);
    expect(outcome.errors.text).not.toContain('secret text');
  });

  it('bounds the messages it keeps and counts the rest as an error', () => {
    expect(outcome.bound.traffic).toHaveLength(200);
    expect(outcome.bound.validationErrorCount).toBeGreaterThan(
      outcome.errors.witness.validationErrorCount,
    );
  });
});
