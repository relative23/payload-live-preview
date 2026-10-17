/**
 * The Payload 2 lane reads every native case from one record the preview page keeps about its own
 * hook: the admin's messages and those it turned away, the owners and their reads, the receiver the
 * hook listens on, and checkpoints named by the specs. These cases hold that record to what the
 * specs rely on: a stranger leaves a refusal and no row, an owner knows whether it started from its
 * own seed before any message, an aborted read keeps its order and the window it was issued for, a
 * chosen receiver is watched like the first, an error leaves a count and no text, and the exported
 * record can cross the browser's clone. The module runs in its own Node process against a minimal
 * window, as the page would.
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
  readonly target: string;
  readonly aborted: boolean;
  readonly abortSeq: number | null;
  readonly status: number | null;
  readonly threw: boolean;
  readonly settledSeq: number | null;
}

interface Row {
  readonly target: string;
  readonly reason?: string;
  readonly origin?: string;
  readonly marker?: string;
  readonly schemaShape?: string;
}

interface Witness {
  readonly sequence: number;
  readonly target: string;
  readonly owners: readonly Record<string, unknown>[];
  readonly traffic: readonly Row[];
  readonly refusedTraffic: readonly Row[];
  readonly foreignOrigin: number;
  readonly calls: readonly Call[];
  readonly phases: readonly Record<string, unknown>[];
  readonly hydrationErrorCount: number;
  readonly validationErrorCount: number;
}

interface Options {
  readonly allowedOrigins: readonly string[];
  readonly eventSourcePolicy: string;
  readonly hasTarget: boolean;
}

interface Outcome {
  readonly noWindow: { readonly ledger: unknown; readonly owner: unknown };
  readonly shapes: readonly unknown[];
  readonly afterStrangers: Witness;
  readonly owners: Witness;
  readonly aborted: Witness;
  readonly control: {
    readonly selected: readonly number[];
    readonly refusals: readonly string[];
    readonly witness: Witness;
  };
  readonly options: {
    readonly plain: Options;
    readonly switched: Options;
    readonly secondary: Options;
  };
  readonly stubborn: {
    readonly signalReachedFetch: boolean;
    readonly witness: Witness;
  };
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
const PREVIEW = 'http://preview.test:4571';
const listeners = [];
const secondaryListeners = [];
const parent = {};
const { beginOwner, connection, installControls, ledger, observeSnapshot } = await import(
  pathToFileURL(process.env.PLP_LEDGER).href
);
const noWindow = { ledger: ledger(), owner: beginOwner('react', 'homepage', 1, {}) };
const own = {
  parent,
  addEventListener: (type, fn) => listeners.push([type, fn]),
  removeEventListener: (type, fn) => {
    const at = listeners.findIndex(([t, f]) => t === type && f === fn);
    if (at >= 0) listeners.splice(at, 1);
  },
};
const secondary = {
  parent,
  location: { origin: PREVIEW },
  addEventListener: (type, fn) => secondaryListeners.push([type, fn]),
};
const elsewhere = {
  parent,
  get location() {
    throw new DOMException('cross-origin', 'SecurityError');
  },
  addEventListener: () => undefined,
};
parent.frames = [own, secondary, elsewhere];
globalThis.window = own;
globalThis.location = { origin: PREVIEW };
const send = (to, data, init = {}) => {
  const event = { origin: init.origin ?? ADMIN, source: init.source ?? parent, data };
  for (const [type, fn] of to) if (type === 'message') fn(event);
};
const post = (data, init) => send(listeners, data, init);
const message = (extra = {}) => ({ type: 'payload-live-preview', data: { title: 'T' }, ...extra });
const witness = () => window.__r6Witness.export();
const selected = [];
installControls(ADMIN, (_target, index) => selected.push(index));

const shapes = [];
for (const schema of [[{ name: 'title' }], '[]', undefined, { name: 'title' }]) {
  post(message(schema === undefined ? {} : { fieldSchemaJSON: schema }));
  shapes.push(witness().traffic.at(-1).schemaShape);
}
const before = witness().traffic.length;
post(message({ data: { title: 'Stranger title' } }), { origin: 'http://stranger.test' });
post(message({ data: { title: 'Other window title' } }), { source: {} });
post(message({ data: { title: 42 } }), { origin: 'http://stranger-two.test' });
post(message({ data: { title: 'x'.repeat(3000) } }), { origin: 'http://stranger-three.test' });
post(message({ data: { title: ['x'] } }), { origin: 'http://stranger-four.test' });
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

const control = (data, init) => {
  try {
    post({ type: 'r6-control', ...data }, init);
    return 'returned';
  } catch (error) {
    return error.message;
  }
};
const refusals = [
  control({ action: 'target', index: 0 }),
  control({ action: 'target', index: 2 }),
  control({ action: 'target', index: 1 }, { source: {} }),
  control({ action: 'target', index: 1 }, { origin: 'http://stranger.test' }),
  control({ action: 'other', index: 1 }),
  control({ action: 'target', index: 'one' }),
];
if (selected.length !== 0) throw new Error('a refused control selected a receiver');
if (control({ action: 'target', index: 1 }) !== 'returned') throw new Error('the control failed');
send(secondaryListeners, message({ fieldSchemaJSON: [] }));
send(secondaryListeners, message(), { origin: 'http://stranger.test' });
send(secondaryListeners, message(), { source: {} });
const controlWitness = witness();

const plain = connection(ADMIN, undefined, owner);
globalThis.window.__r6Knobs = {
  policy: 'any',
  origins: ['http://127.0.0.1:4571'],
  fetch: 'stubborn',
};
const switched = connection(ADMIN, undefined, owner);
const toSecondary = connection(ADMIN, secondary, owner);
const options = {
  plain: { allowedOrigins: plain.allowedOrigins, eventSourcePolicy: plain.eventSourcePolicy, hasTarget: 'target' in plain },
  switched: { allowedOrigins: switched.allowedOrigins, eventSourcePolicy: switched.eventSourcePolicy, hasTarget: 'target' in switched },
  secondary: { allowedOrigins: toSecondary.allowedOrigins, eventSourcePolicy: toSecondary.eventSourcePolicy, hasTarget: toSecondary.target === secondary },
};
let signalReachedFetch = null;
globalThis.fetch = async (_input, init) => {
  signalReachedFetch = init?.signal !== undefined;
  return { status: 200 };
};
const slowController = new AbortController();
const slow = switched.fetchFn('http://admin.test:4570/api/authors?where[id][in]=3', { signal: slowController.signal });
slowController.abort();
await slow;
const stubborn = { signalReachedFetch, witness: witness() };

const known = window.__r6Witness.checkpoint('final');
const unknown = window.__r6Witness.checkpoint('somewhere else');
const checkpoints = { known, unknown, witness: witness() };

window.__r6.hydrationErrors.push('secret text');
const errors = { text: JSON.stringify(witness()), witness: witness() };

for (let index = 0; index < 250; index += 1) post(message());
const bound = witness();
console.log(JSON.stringify({ noWindow, shapes, afterStrangers, owners, aborted, control: { selected, refusals, witness: controlWitness }, options, stubborn, checkpoints, errors, bound }));
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

  it('counts a message from another origin and lists a message from another window apart', () => {
    expect(outcome.afterStrangers.foreignOrigin).toBe(4);
    expect(outcome.afterStrangers.refusedTraffic.map((row) => row.reason)).toEqual([
      'foreign-origin',
      'wrong-source',
      'foreign-origin',
      'foreign-origin',
      'foreign-origin',
    ]);
  });

  it('keeps of a refused message the receiver, the origin and a bounded title, nothing else', () => {
    const row = (origin: string, marker?: string, reason = 'foreign-origin') => ({
      seq: expect.any(Number) as number,
      target: 'primary',
      origin,
      ...(marker === undefined ? {} : { marker }),
      reason,
    });
    expect(outcome.afterStrangers.refusedTraffic).toEqual([
      row('http://stranger.test', 'Stranger title'),
      row('http://admin.test:4570', 'Other window title', 'wrong-source'),
      // A title that is no string, or longer than 2048 characters, leaves no marker.
      row('http://stranger-two.test'),
      row('http://stranger-three.test'),
      row('http://stranger-four.test'),
    ]);
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

  it('names the window a read was issued for', () => {
    expect(outcome.aborted.calls.map((call) => call.target)).toEqual([
      'primary',
      'primary',
      'primary',
    ]);
    expect(outcome.stubborn.witness.calls.at(-1)).toMatchObject({ target: 'primary' });
  });

  it('hands over the receiver the admin names and refuses every other control', () => {
    expect(outcome.control.selected).toEqual([1]);
    expect(outcome.control.witness.target).toBe('secondary');
    expect(outcome.control.refusals).toEqual([
      'The target control needs a second direct admin child',
      // The browser itself refuses to read the origin of a window of another origin.
      'cross-origin',
      'returned',
      'returned',
      'returned',
      'returned',
    ]);
  });

  it('watches the chosen receiver like the first under its own label', () => {
    const { traffic, refusedTraffic, foreignOrigin } = outcome.control.witness;
    expect(traffic.filter((row) => row.target === 'secondary')).toEqual([
      expect.objectContaining({ schemaShape: 'array' }),
    ]);
    expect(refusedTraffic.filter((row) => row.target === 'secondary')).toEqual([
      expect.objectContaining({ reason: 'foreign-origin' }),
      expect.objectContaining({ reason: 'wrong-source' }),
    ]);
    expect(foreignOrigin).toBe(outcome.afterStrangers.foreignOrigin + 1);
  });

  it('configures the hook from the switches of the spec and from the receiver it is given', () => {
    const { plain, switched, secondary } = outcome.options;
    expect(plain).toEqual({
      allowedOrigins: ['http://admin.test:4570'],
      eventSourcePolicy: 'parent-or-opener',
      hasTarget: false,
    });
    expect(switched).toMatchObject({
      allowedOrigins: ['http://admin.test:4570', 'http://127.0.0.1:4571'],
      eventSourcePolicy: 'any',
      hasTarget: false,
    });
    expect(secondary.hasTarget).toBe(true);
  });

  it('lets a stubborn fetch drop the abort signal while the record still sees the abort', () => {
    expect(outcome.stubborn.signalReachedFetch).toBe(false);
    expect(outcome.stubborn.witness.calls.at(-1)).toMatchObject({
      aborted: true,
      status: 200,
      threw: false,
    });
  });

  it('accepts only the checkpoints the specs name', () => {
    expect(typeof outcome.checkpoints.known).toBe('number');
    expect(outcome.checkpoints.unknown).toBeNull();
    expect(outcome.checkpoints.witness.phases).toEqual([
      { phase: 'final', seq: outcome.checkpoints.known },
    ]);
    expect(outcome.checkpoints.witness.validationErrorCount).toBe(
      outcome.stubborn.witness.validationErrorCount + 1,
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
