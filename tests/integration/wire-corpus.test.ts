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
const CAPTURES = [
  { version: '2.32.3' },
  { version: '3.85.0' },
  { version: '3.88.0' },
  { version: '3.89.0' },
  { version: '4.0.0-canary.33' },
] as const;

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

function start(origin: string, skipUnchanged = false): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: buildBuiltinRenderers(),
    originMatcher: (candidate) => candidate === origin,
    readyTargets: [origin],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    skipUnchanged,
    warn: () => {},
  });
  runtime.start();
  return runtime;
}

function fire(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

/**
 * Wait until every accepted revision has reached the DOM. Replaying a capture
 * back to back would supersede each revision before it wrote anything, and a
 * revision that never wrote skips nothing — the counts would then agree for
 * the wrong reason. An admin leaves the same gap: a keystroke is further apart
 * than an animation frame.
 */
async function idle(rt: LivePreviewRuntime): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { accepted, completed } = rt.inspect().revisions;
    if (completed === accepted) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

  /**
   * LP-1, as the recording shows it. Payload fills
   * `externallyUpdatedRelationship` from `useDocumentEvents().mostRecentUpdate`
   * — a level that the previewed document's own save raises and that nothing
   * ever clears again. Every message after a save therefore repeats the same
   * event, naming the previewed document itself. A capture that never saved
   * carries none; that zero is kept out loud rather than left invisible.
   */
  const carrying = updates.filter(
    (message) =>
      message['externallyUpdatedRelationship'] !== null &&
      message['externallyUpdatedRelationship'] !== undefined,
  );

  /** Every plain-string field the capture carries, so the replay has something to write. */
  function boundPage(): string {
    const names = new Set<string>();
    for (const message of updates) {
      for (const [name, value] of Object.entries(message['data'] as Record<string, unknown>)) {
        if (typeof value === 'string') names.add(name);
      }
    }
    return [...names].map((name) => `<p data-payload-field="${name}"></p>`).join('');
  }

  async function replay(rt: LivePreviewRuntime, beforeCarrying?: () => void): Promise<void> {
    for (const message of corpus.messages) {
      if (
        message['externallyUpdatedRelationship'] !== null &&
        message['externallyUpdatedRelationship'] !== undefined
      ) {
        beforeCarrying?.();
      }
      fire(corpus.adminOrigin, message);
      await idle(rt);
    }
    // The premise of both measurements below.
    const { accepted, completed } = rt.inspect().revisions;
    expect(accepted).toBe(updates.length);
    expect(completed).toBe(accepted);
  }

  it('the repeated save event is not one relationship edit per keystroke', async () => {
    document.body.innerHTML = boundPage();
    const rt = start(corpus.adminOrigin, true);
    const seen: unknown[] = [];
    emitter.on('relationshipUpdate', (event) => {
      seen.push(event.detail);
    });
    await replay(rt);
    // A 3.x and 4.x message names the document it previews (`globalSlug` or
    // `collectionSlug`), so the runtime recognises the capture's events as that
    // document's own save and a plugin listener hears nothing: a foreign document
    // is what the event promises. A 2.x message names none, and its event carries
    // only `entitySlug` and `updatedAt`; the runtime then takes the event at its
    // word (relationship-tracker.ts), which is once per save, never once per
    // keystroke.
    const namesItsDocument = updates.some(
      (message) =>
        typeof message['globalSlug'] === 'string' || typeof message['collectionSlug'] === 'string',
    );
    const saves = new Set(
      carrying.map((message) => JSON.stringify(message['externallyUpdatedRelationship'])),
    );
    expect(seen).toHaveLength(namesItsDocument ? 0 : saves.size);
  });

  it('a save does not turn skipUnchanged off for the rest of the session', async () => {
    document.body.innerHTML = boundPage();
    const rt = start(corpus.adminOrigin, true);
    let beforeFirstCarrying: number | undefined;
    await replay(rt, () => {
      beforeFirstCarrying ??= rt.inspect().revisions.skippedUnchanged;
    });
    if (beforeFirstCarrying === undefined) {
      expect(carrying).toEqual([]);
      return;
    }
    // Measured from the first carrying message on: the half before the save
    // skips freely and would hide exactly the half this asserts.
    expect(rt.inspect().revisions.skippedUnchanged - beforeFirstCarrying).toBeGreaterThan(0);
  });
});
