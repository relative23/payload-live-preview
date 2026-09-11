/**
 * What a keystroke costs in time, driven through the whole runtime.
 *
 * `merge-need.test.ts` asks how many requests a burst makes; this asks how long
 * the first change of a quiet phase takes to reach the page. Both halves have
 * to hold at once: the leading write lands in a frame, and the answer that only
 * the server can give still replaces it when it arrives. A leading write that
 * left a bare id standing would be a regression wearing a benchmark's clothes.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireMessage, makeRuntime, textRenderer } from './lifecycle-startup-harness';
import { mergingFetch, relationshipRenderer } from './populating-server-harness';

const WINDOW_MS = 50;
/** A faked animation frame lands at 16 ms: inside this, and far inside the window. */
const FRAME_MS = 20;

function edit(data: Record<string, unknown>): void {
  fireMessage({ type: 'payload-live-preview', collectionSlug: 'events', data });
}

/**
 * Every value the element ever held, in order. Sampling between messages cannot
 * answer the question these tests ask: a bare id written and replaced inside one
 * window would sit between two samples and never be seen.
 */
function everyValueOf(element: Element): readonly string[] {
  const seen: string[] = [];
  new MutationObserver(() => {
    seen.push(element.textContent);
  }).observe(element, { subtree: true, childList: true, characterData: true });
  return seen;
}

/** A page whose one binding needs the server, started and ready for messages. */
function withVenue(): ReturnType<typeof makeRuntime> {
  document.body.innerHTML =
    '<a data-payload-field="venue" data-payload-type="relationship">no venue yet</a>';
  const runtime = makeRuntime({
    debounceMs: WINDOW_MS,
    renderers: { text: textRenderer(), relationship: relationshipRenderer() },
    dataMerge: {
      serverURL: 'https://cms.example.com',
      fetchFn: mergingFetch() as unknown as typeof fetch,
    },
  });
  runtime.start();
  return runtime;
}

describe('the leading write of a quiet phase', () => {
  it('reaches the page in a frame instead of after the window', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const runtime = makeRuntime({ debounceMs: WINDOW_MS });
    runtime.start();

    edit({ id: 'event-1', title: 'Title 1' });
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(document.querySelector('h1')?.textContent).toBe('Title 1');
    runtime.destroy();
  });

  it('still coalesces everything the burst it opened brings after it', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const runtime = makeRuntime({ debounceMs: WINDOW_MS });
    runtime.start();
    const heading = document.querySelector('h1');

    edit({ id: 'event-1', title: 'A' });
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(heading?.textContent).toBe('A');

    edit({ id: 'event-1', title: 'B' });
    await vi.advanceTimersByTimeAsync(10);
    edit({ id: 'event-1', title: 'C' });
    await vi.advanceTimersByTimeAsync(10);
    // Inside the window the page keeps what the leading write put there; the
    // debounce is still the debounce, it just no longer brakes the first write.
    expect(heading?.textContent).toBe('A');

    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2);
    expect(heading?.textContent).toBe('C');
    runtime.destroy();
  });

  it('writes no id for a field the message can only name, and waits for the answer', async () => {
    // A relationship filled from empty inside a burst: the message carries the
    // id and nothing else, and the request that would resolve it is the one this
    // burst shares. The leading write must not put the id on the page in the
    // meantime, and the answer has to arrive.
    const runtime = withVenue();
    const link = document.querySelector('a');
    if (link === null) throw new Error('binding missing');
    const seen = everyValueOf(link);

    edit({ id: 'event-1', title: 'Title' });
    await vi.advanceTimersByTimeAsync(30);
    edit({ id: 'event-1', title: 'Title', venue: 'venue-2' });
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 8);

    expect(seen).toEqual(['Halle Acht']);
    runtime.destroy();
  });

  it('leaves no bare id behind over a whole burst', async () => {
    const runtime = withVenue();
    const link = document.querySelector('a');
    if (link === null) throw new Error('binding missing');
    const seen = everyValueOf(link);

    // The audit's cadence: the first message buys the document and the six
    // after it share one request, so every one of them is a leading write with
    // an unresolved relationship in its hand.
    for (let index = 0; index < 7; index += 1) {
      edit({
        id: 'event-1',
        ...(index === 0 ? {} : { venue: index % 2 === 0 ? 'venue-1' : 'venue-2' }),
      });
      await vi.advanceTimersByTimeAsync(30);
    }
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 8);

    expect(seen.filter((value) => value.startsWith('venue-'))).toEqual([]);
    // The last message named venue-1; anything else means the refinement was
    // lost, and the link an editor is looking at is stale or empty.
    expect(link.textContent).toBe('Halle Sieben');
    runtime.destroy();
  });
});
