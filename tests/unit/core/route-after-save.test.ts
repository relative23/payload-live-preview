/**
 * A route refresh asks the server again, and the server renders what is saved:
 * a field no binding covers shows its saved value, which the runtime reports as
 * a `partial` render (ADR 0018). Once Payload saves the document, the server
 * has the edit — and nothing used to ask it again, so the preview kept the old
 * value until the next change in the form. Payload says when it saved:
 * `payload-document-event`, after every save, the autosave included.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FragmentStrategy, RouteOutcome, RouteStrategy } from '@core/strategies';
import type { LivePreviewRuntime } from '@core/lifecycle';
import { fragmentStrategyFrom } from '@fragment/index';
import { buildBuiltinRenderers } from '@field-types/index';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** Answers every refresh with `outcome` and never claims a binding of its own. */
function fakeRoute(outcome: RouteOutcome): RouteStrategy & { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<RouteOutcome> => {
      strategy.refreshes += 1;
      return Promise.resolve(outcome);
    },
  };
  return strategy;
}

type RuntimeOptions = Parameters<typeof makeRuntime>[0];

function start(route: RouteStrategy, options: RuntimeOptions = {}): LivePreviewRuntime {
  document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
  const runtime = makeRuntime({ strategies: { route }, warn: () => {}, ...options });
  runtime.start();
  return runtime;
}

async function send(data: Record<string, unknown>): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data });
  await vi.advanceTimersByTimeAsync(50);
}

async function saved(): Promise<void> {
  fireMessage({ type: 'payload-document-event', action: 'updated' });
  await vi.advanceTimersByTimeAsync(50);
}

/** The connection's first message, then an edit of a field the page does not bind. */
async function editUnbound(callout: string): Promise<void> {
  await send({ title: 'Server rendered', callout: 'saved callout' });
  await send({ title: 'Server rendered', callout });
}

describe('a route render that could only show the saved document', () => {
  it('runs once more when Payload reports the save', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await editUnbound('typed, not yet saved');
    expect(route.refreshes).toBe(1);

    await saved();

    expect(route.refreshes).toBe(2);
    runtime.destroy();
  });

  it('runs once per save that follows it, not on every later save', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await editUnbound('typed, not yet saved');

    await saved();
    await saved();

    expect(route.refreshes).toBe(2);
    runtime.destroy();
  });

  it('still runs when the revisions after it touched only bound fields', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await editUnbound('typed, not yet saved');
    await send({ title: 'Patched in place', callout: 'typed, not yet saved' });
    expect(route.refreshes).toBe(1);

    await saved();

    expect(route.refreshes).toBe(2);
    runtime.destroy();
  });

  it('re-applies the current revision onto the markup the save produced', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await editUnbound('typed, not yet saved');
    await send({ title: 'Typed after the refresh', callout: 'typed, not yet saved' });

    await saved();

    expect(document.querySelector('h1')?.textContent).toBe('Typed after the refresh');
    runtime.destroy();
  });
});

describe('a save with nothing left to refresh', () => {
  it('asks nothing after a render that carried the unsaved document', async () => {
    const route = fakeRoute('refreshed');
    const runtime = start(route);
    await editUnbound('typed, not yet saved');

    await saved();

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('asks nothing when every change so far was patched in place', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await send({ title: 'Server rendered', callout: 'saved callout' });
    await send({ title: 'Patched in place', callout: 'saved callout' });

    await saved();

    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('asks nothing after a navigation whose replay patched every field in place', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await send({ title: 'Server rendered' });
    await send({ title: 'Patched in place' });
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);

    await saved();

    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });
});

/**
 * A navigation is a server render of the new route: the replay of the last
 * message lands on markup that was rendered from the saved document a moment
 * ago. Measured on a site that binds nothing of the edited document on the
 * page it navigated to: every field counted as an unbound change, LP0807
 * refreshed the route about 35 ms after the swap, fetched the same bytes and
 * replaced what the host had added to the page since.
 */
describe('a navigation onto a page that does not bind the document', () => {
  async function navigateAway(runtime: LivePreviewRuntime): Promise<void> {
    document.body.innerHTML = '<p>A page that shows none of this document</p>';
    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
  }

  it('does not refresh the route it just rendered', async () => {
    const log = vi.fn<(...args: unknown[]) => void>();
    const route = fakeRoute('partial');
    const runtime = start(route, { log });
    await send({ title: 'Server rendered', callout: 'saved callout' });
    await send({ title: 'Patched in place', callout: 'saved callout' });

    await navigateAway(runtime);

    expect(route.refreshes).toBe(0);
    expect(log.mock.calls.some((call) => call.includes('LP0807'))).toBe(false);
    expect(runtime.inspect().route.refreshes).toBe(0);
    // What the replay cannot show is the saved document, as after a partial render.
    expect(runtime.inspect().revisions.display?.shortfalls).toEqual([{ kind: 'route-saved' }]);
    runtime.destroy();
  });

  it('renders the route once Payload reports the save', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await send({ title: 'Server rendered', callout: 'saved callout' });
    await navigateAway(runtime);

    await saved();

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('still refreshes for a field the editor changes after the navigation', async () => {
    const route = fakeRoute('partial');
    const runtime = start(route);
    await send({ title: 'Server rendered', callout: 'saved callout' });
    await navigateAway(runtime);

    await send({ title: 'Server rendered', callout: 'typed after the navigation' });

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });
});

describe('a throw after the refresh a save asked for', () => {
  it('is logged instead of left unhandled', async () => {
    const log = vi.fn<(...args: unknown[]) => void>();
    const base = fragmentStrategyFrom(() => Promise.resolve({ status: 'rendered', html: '' }));
    let armed = false;
    const fragment: FragmentStrategy = {
      ...base,
      plan: (root, changed) => {
        if (armed) throw new Error('plan exploded');
        return base.plan(root, changed);
      },
    };
    const route = fakeRoute('partial');
    const runtime = start(route, { strategies: { route, fragment }, log });
    await editUnbound('typed, not yet saved');
    armed = true;

    await saved();

    const failures = log.mock.calls.filter(([message]) => message === 'route refresh failed:');
    expect(route.refreshes).toBe(2);
    expect(failures).toHaveLength(1);
    runtime.destroy();
  });
});

/**
 * The osteria kicker (site audit of 27.10.2026, C2): an element with markup
 * inside (`<span lang="it">`) cannot be patched, so each edit is escalated and
 * the route renders the saved draft once Payload saves. The second edit was
 * never escalated, so no save rendered it again.
 */
describe('an element no patch can write, edited twice', () => {
  // B8: the first message carries what the server rendered, so it is no edit to escalate.
  it('asks for no route on connecting, when the element already shows the value', async () => {
    const route = fakeRoute('partial');
    document.body.innerHTML = '<p data-payload-field="kicker">La <span lang="it">cucina</span></p>';
    const runtime = makeRuntime({
      renderers: buildBuiltinRenderers(),
      strategies: { route },
      warn: () => {},
    });
    runtime.start();
    await send({ kicker: 'La cucina' });

    expect(route.refreshes).toBe(0);
    expect(runtime.inspect().fidelity.unfaithful).toBe(0);
    expect(document.querySelector('[lang="it"]')?.textContent).toBe('cucina');
    runtime.destroy();
  });

  it('reaches the route after each save', async () => {
    const route = fakeRoute('partial');
    document.body.innerHTML = '<p data-payload-field="kicker">La <span lang="it">cucina</span></p>';
    const runtime = makeRuntime({
      renderers: buildBuiltinRenderers(),
      strategies: { route },
      warn: () => {},
    });
    runtime.start();
    await send({ kicker: 'La cucina' });
    await send({ kicker: 'La cucina nuova' });
    await saved();
    const afterFirstSave = route.refreshes;

    await vi.advanceTimersByTimeAsync(1000);
    await send({ kicker: 'La cucina di casa' });
    await saved();

    expect(route.refreshes).toBe(afterFirstSave + 2);
    runtime.destroy();
  });
});
