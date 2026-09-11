/**
 * What a keystroke costs in requests. Every case here counts calls on the
 * injected `fetch`, not DOM state: the finding these tests come from (LP-3,
 * LP-4) was invisible to a suite that only asserted what the page shows.
 *
 * The five scenarios are the ones the interaction budget names — plain text
 * field, rich text, relationship field, unbound field, page without bindings —
 * driven at the cadence the audit measured: eighteen messages, thirty
 * milliseconds apart, against the default fifty-millisecond window.
 */

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import { fireMessage, makeRuntime, textRenderer } from './lifecycle-startup-harness';
import { mergingFetch, relationshipRenderer, VENUES } from './populating-server-harness';

const KEYSTROKES = 18;
const KEYSTROKE_MS = 30;
const WINDOW_MS = 50;

function richTextRenderer(): FieldRenderer {
  return {
    name: 'richText',
    render(target, value) {
      const root = (value as { root?: { text?: string } } | null)?.root;
      target.element.textContent = root?.text ?? '';
    },
  };
}

function runtimeWith(
  fetchFn: unknown,
  emitter = new EventEmitter(),
): ReturnType<typeof makeRuntime> {
  return makeRuntime({
    emitter,
    debounceMs: WINDOW_MS,
    renderers: {
      text: textRenderer(),
      relationship: relationshipRenderer(),
      richText: richTextRenderer(),
    },
    dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
  });
}

/** Eighteen messages at the audit's cadence, then long enough for any trailing window. */
async function keystrokes(field: (index: number) => Record<string, unknown>): Promise<void> {
  for (let index = 0; index < KEYSTROKES; index += 1) {
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'Title', venue: 'venue-1', ...field(index) },
    });
    await vi.advanceTimersByTimeAsync(KEYSTROKE_MS);
  }
  await vi.advanceTimersByTimeAsync(WINDOW_MS * 8);
}

describe('what a keystroke costs (LP-3, LP-4)', () => {
  it('a plain text field costs no request at all', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    await keystrokes((index) => ({ title: `Title ${String(index)}` }));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('Title 17');
    runtime.destroy();
  });

  it('a page without a single binding never asks the server', async () => {
    document.body.innerHTML = '<main><p>nothing bound here</p></main>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    await keystrokes((index) => ({ title: `Title ${String(index)}` }));

    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('a page without bindings stays silent even when the route could escalate', async () => {
    // Since Z3 an unbound change refreshes the route by default. The refresh
    // re-renders from the server and never reads the merged values, so it is
    // not a consumer of this request.
    document.body.innerHTML = '<main><p>nothing bound here</p></main>';
    const fetchFn = mergingFetch();
    const refresh = vi.fn().mockResolvedValue('refreshed');
    const runtime = makeRuntime({
      debounceMs: WINDOW_MS,
      strategies: { route: { plan: () => false, refresh } },
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();

    await keystrokes((index) => ({ title: `Title ${String(index)}` }));

    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('a field nobody binds costs nothing on a page of plain bindings', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    await keystrokes((index) => ({ subtitle: `Subtitle ${String(index)}` }));

    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('a relationship field costs one request to open the burst and one to close it', async () => {
    document.body.innerHTML =
      '<h1 data-payload-field="title">old</h1>' +
      '<a data-payload-field="venue" data-payload-type="relationship">old venue</a>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    await keystrokes((index) => ({ venue: index % 2 === 0 ? 'venue-1' : 'venue-2' }));

    expect(fetchFn.mock.calls.length).toBe(2);
    // The line that must never reach zero: the id would be on the page instead.
    expect(document.querySelector('a')?.textContent).toBe('Halle Acht');
    runtime.destroy();
  });

  it('never writes the bare id while the coalesced request is still out', async () => {
    document.body.innerHTML =
      '<a data-payload-field="venue" data-payload-type="relationship">old venue</a>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    const seen: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      fireMessage({
        type: 'payload-live-preview',
        collectionSlug: 'events',
        data: { id: 'event-1', venue: index % 2 === 0 ? 'venue-1' : 'venue-2' },
      });
      await vi.advanceTimersByTimeAsync(KEYSTROKE_MS);
      seen.push(document.querySelector('a')?.textContent ?? '');
    }
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 8);

    expect(seen.every((text) => !text.startsWith('venue-'))).toBe(true);
    expect(document.querySelector('a')?.textContent).toBe('Halle Acht');
    runtime.destroy();
  });

  it('rich text pays for the burst, not for the keystroke', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-type="richText"></div>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    await keystrokes((index) => ({ body: { root: { text: `line ${String(index)}` } } }));

    expect(fetchFn.mock.calls.length).toBe(2);
    // The typed text is on the page while the request is still out; only what
    // the server populates inside the tree waits for the answer.
    expect(document.querySelector('div')?.textContent).toBe('line 17');
    runtime.destroy();
  });

  it('asks again when a save in another document changes what population returns', async () => {
    document.body.innerHTML =
      '<a data-payload-field="venue" data-payload-type="relationship">old venue</a>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', venue: 'venue-1' },
    });
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);
    expect(fetchFn.mock.calls.length).toBe(1);

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', venue: 'venue-1' },
      externallyUpdatedRelationship: {
        entitySlug: 'venues',
        id: 'venue-1',
        updatedAt: '2026-09-07T10:00:00.000Z',
      },
    });
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);

    expect(fetchFn.mock.calls.length).toBe(2);
    runtime.destroy();
  });

  it('a plugin that reads the document is a consumer, even without a binding', async () => {
    document.body.innerHTML = '<main><p>nothing bound here</p></main>';
    const fetchFn = mergingFetch();
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', () => undefined);
    const runtime = runtimeWith(fetchFn, emitter);
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'Title' },
    });
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);

    expect(fetchFn.mock.calls.length).toBe(1);
    runtime.destroy();
  });

  it('the answer to a shared request refines the page without asking for a refresh', async () => {
    // The refinement is not an edit. Without that, a value only the server knows
    // — here `venueName`, which nothing binds and which moves with the relation —
    // reads as a changed field with no anchor, and every burst ends in a refresh.
    document.body.innerHTML =
      '<a data-payload-field="venue" data-payload-type="relationship">old venue</a>';
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      const sent = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(sent) as { data: Record<string, unknown> };
      const venue = body.data['venue'];
      const resolved = typeof venue === 'string' ? VENUES[venue] : venue;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...body.data,
            venue: resolved,
            venueName: (resolved as { title?: string } | undefined)?.title ?? '',
          }),
        ),
      );
    });
    const refresh = vi.fn().mockResolvedValue('refreshed');
    const runtime = makeRuntime({
      debounceMs: WINDOW_MS,
      renderers: { text: textRenderer(), relationship: relationshipRenderer() },
      strategies: { route: { plan: () => false, refresh } },
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();

    await keystrokes((index) => ({ venue: index % 2 === 0 ? 'venue-1' : 'venue-2' }));

    expect(document.querySelector('a')?.textContent).toBe('Halle Acht');
    expect(refresh).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('a stopped runtime sends no request the window still owed', async () => {
    document.body.innerHTML =
      '<a data-payload-field="venue" data-payload-type="relationship">old venue</a>';
    const fetchFn = mergingFetch();
    const runtime = runtimeWith(fetchFn);
    runtime.start();

    for (const venue of ['venue-1', 'venue-2', 'venue-1']) {
      fireMessage({
        type: 'payload-live-preview',
        collectionSlug: 'events',
        data: { id: 'event-1', venue },
      });
      await vi.advanceTimersByTimeAsync(KEYSTROKE_MS);
    }
    expect(fetchFn.mock.calls.length).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    runtime.destroy();
    // The window is closed, not merely ignored: a timer left behind would fire
    // a credentialed request from a page that has stopped previewing.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 8);

    expect(fetchFn.mock.calls.length).toBe(1);
  });
});
