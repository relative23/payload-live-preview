import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';
import { observeCapabilities } from '@core/protocol-version';

/**
 * The wire corpus (roadmap 1.8.0): messages captured verbatim from real
 * Payload admins, replayed through the real runtime. Every capture must
 * validate on the bus, render into bound elements, and demonstrate exactly
 * the capabilities the runtime then reports — so a Payload release that
 * changes the wire shape fails here, with the version in the test name.
 */

interface Corpus {
  readonly payload: string;
  readonly capturedAt: string;
  readonly adminOrigin: string;
  readonly messages: readonly Record<string, unknown>[];
}

const DIRECTORY = resolve('tests/fixtures/wire-corpus');
/**
 * The captures, listed literally so the suite registers statically (test
 * policy) and a new recording has to be named here to count.
 */
const CAPTURES = [{ version: '3.85.0' }, { version: '3.88.0' }] as const;

function load(version: string): Corpus {
  return JSON.parse(readFileSync(resolve(DIRECTORY, `payload-${version}.json`), 'utf8')) as Corpus;
}

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

function start(origin: string): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: buildBuiltinRenderers(),
    originMatcher: (candidate) => candidate === origin,
    readyTargets: [origin],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
  });
  runtime.start();
  return runtime;
}

function fire(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

it('the listed captures are exactly the files on disk, and cover a 3.x admin', () => {
  const files = readdirSync(DIRECTORY)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/^payload-/u, '').replace(/\.json$/u, ''))
    .sort();
  expect(files).toEqual(CAPTURES.map((capture) => capture.version));
  expect(files.some((version) => version.startsWith('3.'))).toBe(true);
});

describe.each(CAPTURES)('Payload $version', ({ version }) => {
  const corpus = load(version);
  const updates = corpus.messages.filter(
    (message) => message['type'] === 'payload-live-preview' && message['data'] !== undefined,
  );
  const documentEvents = corpus.messages.filter(
    (message) => message['type'] === 'payload-document-event',
  );

  it('every captured message passes the bus without a rejection', async () => {
    document.body.innerHTML = '<p data-payload-field="title"></p>';
    const rt = start(corpus.adminOrigin);
    const rejected: unknown[] = [];
    emitter.on('error', (event) => {
      rejected.push(event.code);
    });
    for (const message of corpus.messages) fire(corpus.adminOrigin, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejected).toEqual([]);
    expect(rt.inspect().revisions.accepted).toBe(updates.length);
  });

  it('the last update renders a string field the capture carries', async () => {
    const last = updates.at(-1);
    if (last === undefined) throw new Error('corpus without a data update');
    const data = last['data'] as Record<string, unknown>;
    // Bind whatever scalar text the capture holds; fixtures differ per version.
    const field = Object.entries(data).find(
      ([name, value]) =>
        typeof value === 'string' && !['id', 'createdAt', 'updatedAt'].includes(name),
    );
    if (field === undefined) throw new Error('capture without a string field');
    document.body.innerHTML = `<h1 data-payload-field="${field[0]}"></h1>`;
    start(corpus.adminOrigin);
    const done = new Promise<void>((resolve) => {
      emitter.once('afterUpdate', () => {
        resolve();
      });
    });
    fire(corpus.adminOrigin, last);
    await done;
    expect(document.querySelector('h1')?.textContent).toBe(field[1]);
  });

  it('reports exactly the capabilities the captures demonstrate', async () => {
    document.body.innerHTML = '<p data-payload-field="title"></p>';
    const rt = start(corpus.adminOrigin);
    for (const message of corpus.messages) fire(corpus.adminOrigin, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const expected = new Set<string>();
    for (const message of updates) for (const c of observeCapabilities(message)) expected.add(c);
    if (documentEvents.length > 0) expected.add('document-events');
    expect(rt.inspect().protocol.observed).toEqual([...expected].sort());
  });

  it('every captured document event fires documentSave (none in a capture without saves)', () => {
    document.body.innerHTML = '';
    start(corpus.adminOrigin);
    let saves = 0;
    emitter.on('documentSave', () => {
      saves += 1;
    });
    for (const message of documentEvents) fire(corpus.adminOrigin, message);
    expect(saves).toBe(documentEvents.length);
  });
});
