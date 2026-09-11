/**
 * The pipeline's edges: what it does when the host's own code fails under
 * it, and the two shapes of a message that end its work early. Each ends in
 * a log line or a request not made, never in an unhandled rejection: nothing
 * awaits these paths, so a throw that escaped would be a console error the
 * host cannot attribute, and a process exit under strict rejections.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteStrategy } from '@core/strategies';
import type { RuntimeOptions } from '@core/lifecycle';
import { mergingFetch, relationshipRenderer } from './populating-server-harness';
import {
  post,
  startRuntime,
  stubIntersectionObserver,
  textRenderer,
  type RuntimeHarness,
} from '../../helpers/runtime';

/** The scheduler's debounce, and with it the window a burst's merge requests share. */
const WINDOW_MS = 50;

let harness: RuntimeHarness | undefined;
/** jsdom ships no scrollIntoView, so restoring the stub may mean removing it. */
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

beforeEach(() => {
  vi.useFakeTimers();
  stubIntersectionObserver();
});

afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
  if (scrollIntoView === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  else Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function start(overrides: Partial<RuntimeOptions> = {}): RuntimeHarness {
  harness = startRuntime({ eventSourcePolicy: 'any', ...overrides });
  return harness;
}

/** A collection document, so the merger has an endpoint to ask. */
function edit(data: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  post(data, { extra: { collectionSlug: 'events', ...extra } });
}

function failures(): string[] {
  return harness?.logs.filter((line) => line.startsWith('update failed:')) ?? [];
}

/** A page that reads a populated value, which is what makes a merge worth a request. */
function withVenue(): Partial<RuntimeOptions> {
  document.body.innerHTML =
    '<h1 data-payload-field="title">old</h1>' +
    '<a data-payload-field="venue" data-payload-type="relationship">no venue yet</a>';
  return {
    renderers: { text: textRenderer(), relationship: relationshipRenderer() },
    dataMerge: {
      serverURL: 'https://cms.example.com',
      fetchFn: mergingFetch() as unknown as typeof fetch,
    },
  };
}

describe('the reveal', () => {
  it('logs a scroll that throws instead of failing the flush that owed it', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    // A host may have replaced scrollIntoView — a smooth-scroll polyfill, a
    // locked scroll container. One that throws must not take the flush down.
    Element.prototype.scrollIntoView = () => {
      throw new Error('scroll refused');
    };
    const { logs } = start({ revealEditedField: true });

    edit({ id: 'event-1', title: 'a' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    edit({ id: 'event-1', title: 'b' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    expect(document.querySelector('h1')?.textContent).toBe('b');
    expect(logs.filter((line) => line.startsWith('reveal '))).toEqual([
      'reveal Error: scroll refused',
    ]);
  });
});

describe('the lean runtime', () => {
  it('names auto-binding as left out instead of searching the page', async () => {
    vi.stubGlobal('__LEAN_BUILD__', true);
    const consoleWarnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleWarnings.push(args.map((arg) => String(arg)).join(' '));
    });
    // Exactly what the search would bind: one element whose whole content is the value.
    document.body.innerHTML = '<h1>Saved title</h1>';
    start({ autoBind: 'unique' });

    edit({ id: 'event-1', title: 'Saved title' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    edit({ id: 'event-1', title: 'edited in the admin' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    const omitted = consoleWarnings.filter((message) => message.includes('LP0104'));
    expect(omitted).toHaveLength(1);
    expect(omitted[0]).toContain('auto-binding');
    expect(document.querySelector('h1')?.textContent).toBe('Saved title');
  });
});

describe('the merge', () => {
  it('asks the server for nothing when a Payload 2.x admin populates the document itself', async () => {
    const options = withVenue();
    const fetchFn = options.dataMerge?.fetchFn;
    start(options);

    // `fieldSchemaJSON` on the wire is the 2.x signature, and that admin posts
    // relationships populated; a request would only fetch what it already sent.
    edit(
      { id: 'event-1', title: 'Title', venue: { id: 'venue-1', title: 'Halle Sieben' } },
      { fieldSchemaJSON: [] },
    );
    await vi.advanceTimersByTimeAsync(WINDOW_MS);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('a')?.textContent).toBe('Halle Sieben');
  });

  it('logs a shared answer the host strategy throws on, and stays up for the next edit', async () => {
    let armed = false;
    const route: RouteStrategy = {
      plan: () => {
        if (armed) throw new Error('plan refused');
        return false;
      },
      refresh: () => Promise.resolve('refreshed'),
    };
    start({ ...withVenue(), debounceMs: WINDOW_MS, strategies: { route } });

    edit({ id: 'event-1', title: 'Title' });
    await vi.advanceTimersByTimeAsync(20);
    // Inside the window: this message renders what it has and shares the
    // request that follows the burst, which nothing awaits.
    edit({ id: 'event-1', title: 'Title', venue: 'venue-2' });
    await vi.advanceTimersByTimeAsync(10);
    expect(failures()).toEqual([]);

    // Only the shared answer is still to come; from here the host's plan fails.
    armed = true;
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);
    expect(failures()).toEqual(['update failed: Error: plan refused']);

    armed = false;
    edit({ id: 'event-1', title: 'After', venue: 'venue-2' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 4);
    expect(document.querySelector('h1')?.textContent).toBe('After');
    expect(document.querySelector('a')?.textContent).toBe('Halle Acht');
  });
});
