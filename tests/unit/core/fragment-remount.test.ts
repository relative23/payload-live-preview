import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { fragmentStrategyFrom, type FragmentOutcome } from '@fragment/index';

/**
 * A boundary the host replaces while its render is in flight (H06): a
 * component re-rendering its region swaps the element and keeps the
 * fragment's id and key. The render, or the patch after a failed one, lands
 * in the boundary on the page now, never in the detached one, and only when
 * exactly one boundary in the update's owner scope carries that identity.
 * Elements are compared by reference: `toMatchObject` treats any two DOM
 * elements as equal.
 */

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
const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};
const HERO =
  '<section data-payload-fragment="hero" data-payload-fragment-key="a">' +
  '<h1 data-payload-field="title">Old title</h1></section>';
// Boundaries a `title` change does not render, sharing the id or the key.
const NEIGHBOURS =
  '<section data-payload-fragment="hero" data-payload-fragment-key="b" data-payload-depends="footer"></section>' +
  '<section data-payload-fragment="nav" data-payload-fragment-key="a" data-payload-depends="footer"></section>';
// No key: every copy of it on a page shares one identity.
const TWIN =
  '<section data-payload-fragment="twin"><h1 data-payload-field="title">Old title</h1></section>';

interface RenderEvent {
  readonly element: Element;
  readonly status: string;
}
interface Held {
  released: () => boolean;
  release: () => void;
  rendered: Promise<RenderEvent>;
  /** Cache rebuilds since the held render was released. */
  rebuildsSinceRelease: () => number;
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data, globalSlug: 'home' },
      origin: TRUSTED,
    }),
  );
}
function start(
  handler: () => Promise<FragmentOutcome>,
  options: { scopeBindingsByOwner?: boolean } = {},
): void {
  runtime = new LivePreviewRuntime({
    ...options,
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    log: () => {},
    strategies: { fragment: fragmentStrategyFrom(handler) },
  });
  runtime.start();
}
/** Start a runtime whose fragment handler answers with `outcome` once released. */
function startHeld(
  outcome: FragmentOutcome,
  options: { scopeBindingsByOwner?: boolean } = {},
): Held {
  let resolve: ((value: FragmentOutcome) => void) | undefined;
  let rebuilds = 0;
  let atRelease = 0;
  emitter.on('cacheRefresh', () => {
    rebuilds += 1;
  });
  start(
    () =>
      new Promise<FragmentOutcome>((done) => {
        resolve = done;
      }),
    options,
  );
  const rendered = new Promise<RenderEvent>((done) => {
    emitter.once('fragmentRender', done);
  });
  return {
    released: () => resolve !== undefined,
    release: () => {
      atRelease = rebuilds;
      resolve?.(outcome);
    },
    rendered,
    rebuildsSinceRelease: () => rebuilds - atRelease,
  };
}
/** Post a revision and wait until its render is in flight. */
async function postAndHold(held: Held): Promise<void> {
  post({ title: 'New' });
  await vi.waitFor(() => {
    expect(held.released()).toBe(true);
  });
}
/** Replace the in-flight boundary with `copies` of itself, as a re-rendering host does. */
async function remountWhileHeld(
  held: Held,
  copies = 1,
): Promise<{ planned: Element; copies: Element[] }> {
  await postAndHold(held);
  const planned = document.querySelector('[data-payload-fragment-key="a"]')!;
  const made = Array.from({ length: copies }, () => planned.cloneNode(true) as Element);
  planned.replaceWith(...made);
  held.release();
  return { planned, copies: made };
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  document.body.innerHTML = HERO + NEIGHBOURS;
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('fragment remount (H06)', () => {
  it('renders into the boundary that replaced its own and reports that one', async () => {
    const held = startHeld({ status: 'rendered', html: '<h1>New</h1><p>fresh</p>' });
    const { planned, copies } = await remountWhileHeld(held);

    const event = await held.rendered;
    expect(event.status).toBe('rendered');
    expect(event.element).toBe(copies[0]);
    expect(copies[0]?.querySelector('p')?.textContent).toBe('fresh');
    expect(planned.querySelector('p')).toBeNull();
    expect(document.querySelectorAll('section p')).toHaveLength(1);
  });

  it('patches the boundary that replaced its own when the render fails', async () => {
    const held = startHeld({ status: 'failed', code: 'LP0801', reason: 'endpoint down' });
    const { copies } = await remountWhileHeld(held);

    const event = await held.rendered;
    expect(event.status).toBe('failed');
    expect(event.element).toBe(copies[0]);
    await vi.waitFor(() => {
      expect(copies[0]?.querySelector('h1')?.textContent).toBe('New');
    });
  });

  it('writes nowhere, and rebuilds nothing, when the boundary is gone', async () => {
    const held = startHeld({ status: 'failed', code: 'LP0801', reason: 'endpoint down' });
    const { planned } = await remountWhileHeld(held, 0);

    const event = await held.rendered;
    expect(event.status).toBe('failed');
    expect(event.element).toBe(planned);
    expect(planned.querySelector('h1')?.textContent).toBe('Old title');
    expect(held.rebuildsSinceRelease()).toBe(0);
  });

  it('does not rebuild the cache for a failed render of a boundary that stayed', async () => {
    const held = startHeld({ status: 'failed', code: 'LP0801', reason: 'endpoint down' });
    await postAndHold(held);
    const planned = document.querySelector('[data-payload-fragment-key="a"]')!;
    held.release();

    const event = await held.rendered;
    await vi.waitFor(() => {
      expect(planned.querySelector('h1')?.textContent).toBe('New');
    });
    expect(event.element).toBe(planned);
    expect(held.rebuildsSinceRelease()).toBe(0);
  });

  it('renders nowhere when two boundaries claim the identity of the replaced one', async () => {
    const held = startHeld({ status: 'rendered', html: '<h1>New</h1><p>fresh</p>' });
    const { planned } = await remountWhileHeld(held, 2);

    expect((await held.rendered).element).toBe(planned);
    expect(document.querySelectorAll('section p')).toHaveLength(0);
  });

  it('counts only the boundaries inside the update owner scope as claims', async () => {
    document.body.innerHTML =
      `<div data-payload-owner="global:home">${HERO}</div>` +
      `<div data-payload-owner="global:other">${HERO}</div>`;
    const held = startHeld(
      { status: 'rendered', html: '<h1>New</h1><p>fresh</p>' },
      { scopeBindingsByOwner: true },
    );
    const { copies } = await remountWhileHeld(held);
    await held.rendered;

    expect(copies[0]?.querySelector('p')?.textContent).toBe('fresh');
    expect(document.querySelectorAll('section p')).toHaveLength(1);
  });

  it('renders every boundary of a shared identity while all of them are on the page', async () => {
    document.body.innerHTML = TWIN + TWIN;
    start(() => Promise.resolve({ status: 'rendered', html: '<h1>New</h1><p>fresh</p>' }));
    post({ title: 'New' });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('section p')).toHaveLength(2);
    });
  });
});
