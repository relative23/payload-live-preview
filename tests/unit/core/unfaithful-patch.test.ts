/**
 * Z3: the runtime knows, in more places than it used to act on, that the patch
 * it is about to leave on the page is not what the server would have drawn —
 * a renderer that refused the value, a Lexical block whose markup the write
 * dropped, a changed field with no binding at all. `onUnfaithfulPatch` decides
 * what happens then; `'escalate'`, the default, hands the region to the
 * fragment strategy when a boundary covers it and to the route otherwise.
 *
 * The claim under test is *that* it escalates and *which* way it goes. Whether
 * the escalated page then equals the server's own render is the fidelity
 * oracle's question, and it needs an SSR fixture this suite does not have.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { __resetBlockRegistryForTests } from '@lexical/blocks/registry';
import type { FragmentStrategy, RouteStrategy } from '@core/strategies';
import type { LivePreviewRuntime } from '@core/lifecycle';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** Refreshes whatever it is asked to and never claims a binding of its own. */
function fakeRoute(): RouteStrategy & { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<'refreshed'> => {
      strategy.refreshes += 1;
      return Promise.resolve('refreshed' as const);
    },
  };
  return strategy;
}

/** Renders nothing, but records which boundaries it was handed. */
function fakeFragment(): FragmentStrategy & { rendered: Element[] } {
  const strategy = {
    rendered: [] as Element[],
    plan: (): readonly Element[] => [],
    render: (_context: unknown, boundaries: readonly Element[]) => {
      strategy.rendered.push(...boundaries);
      return Promise.resolve({ rendered: boundaries.length, failed: 0, superseded: 0 });
    },
  } satisfies { rendered: Element[] } & Omit<FragmentStrategy, 'render'> & {
      render: FragmentStrategy['render'];
    };
  return strategy;
}

/**
 * A `title` binding the text renderer refuses: the element has structured
 * children and no `data-payload-text`, so writing the value would destroy the
 * consumer's markup (LP0402). Nothing lands, and before Z3 nothing was said.
 */
const UNWRITABLE_TITLE =
  '<h1 data-payload-field="title"><span class="mark">Server rendered</span></h1>';

function start(
  overrides: Partial<ConstructorParameters<typeof LivePreviewRuntime>[0]> = {},
): LivePreviewRuntime {
  const runtime = makeRuntime({ renderers: buildBuiltinRenderers(), ...overrides });
  runtime.start();
  return runtime;
}

/** The connection's first message, then one that changes something. */
async function connectThenEdit(...edits: Record<string, unknown>[]): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data: { title: 'Server rendered' } });
  await vi.advanceTimersByTimeAsync(50);
  for (const edit of edits) {
    fireMessage({ type: 'payload-live-preview', data: edit });
    await vi.advanceTimersByTimeAsync(50);
  }
}

describe('a value the binding cannot represent', () => {
  it('refreshes the route rather than leaving the page unpatched', async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, warn: () => {} });

    await connectThenEdit({ title: 'Typed in the admin' });

    expect(route.refreshes).toBe(1);
    expect(runtime.inspect().route.refreshes).toBe(1);
    // The verdict and its outcome, as a reader of the page sees them.
    expect(runtime.inspect().fidelity).toEqual({
      mode: 'escalate',
      canEscalate: true,
      unfaithful: 1,
      escalated: 1,
      fields: ['title'],
    });
    runtime.destroy();
  });

  it('asks the fragment strategy when a boundary covers the binding', async () => {
    document.body.innerHTML = `<section data-payload-fragment="hero">${UNWRITABLE_TITLE}</section>`;
    const route = fakeRoute();
    const fragment = fakeFragment();
    const runtime = start({ strategies: { route, fragment }, warn: () => {} });

    await connectThenEdit({ title: 'Typed in the admin' });

    expect(
      fragment.rendered.map((element) => element.getAttribute('data-payload-fragment')),
    ).toEqual(['hero']);
    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it('reports canEscalate for a fragment strategy alone', () => {
    document.body.innerHTML = `<section data-payload-fragment="hero">${UNWRITABLE_TITLE}</section>`;
    const runtime = start({ strategies: { fragment: fakeFragment() }, warn: () => {} });
    expect(runtime.inspect().fidelity.canEscalate).toBe(true);
    runtime.destroy();
  });

  it('escalates once per element, so a stuck value is not a refresh per keystroke', async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, warn: () => {} });

    await connectThenEdit(
      { title: 'one' },
      { title: 'two' },
      { title: 'three' },
      { title: 'four' },
    );

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it("keeps 2.0's behaviour under 'ignore'", async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const route = fakeRoute();
    const runtime = start({
      strategies: { route },
      onUnfaithfulPatch: 'ignore',
      warn: () => {},
    });

    await connectThenEdit({ title: 'Typed in the admin' });

    expect(route.refreshes).toBe(0);
    // Counted all the same: the mode decides what is done, not what is seen.
    expect(runtime.inspect().fidelity).toEqual({
      mode: 'ignore',
      canEscalate: true,
      unfaithful: 1,
      escalated: 0,
      fields: ['title'],
    });
    runtime.destroy();
  });

  it("reports LP0411 once under 'warn' and still leaves the patch alone", async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const route = fakeRoute();
    const warnings: string[] = [];
    const runtime = start({
      strategies: { route },
      onUnfaithfulPatch: 'warn',
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      },
    });

    await connectThenEdit({ title: 'one' }, { title: 'two' });

    expect(route.refreshes).toBe(0);
    expect(warnings.filter((line) => line.includes('LP0411'))).toHaveLength(1);
    runtime.destroy();
  });

  it("says LP0411 and not LP0808 under 'warn' with no strategy: nothing was meant to be handed over", async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const warnings: string[] = [];
    const runtime = start({
      onUnfaithfulPatch: 'warn',
      warn: (...args: unknown[]) => {
        warnings.push(String(args[0]));
      },
    });

    await connectThenEdit({ title: 'Typed in the admin' });

    expect(warnings.some((line) => line.includes('LP0411'))).toBe(true);
    expect(warnings.some((line) => line.includes('LP0808'))).toBe(false);
    expect(runtime.inspect().fidelity).toMatchObject({ mode: 'warn', canEscalate: false });
    runtime.destroy();
  });

  it('does nothing at all when there is no strategy to escalate to, and says so once', async () => {
    document.body.innerHTML = UNWRITABLE_TITLE;
    const warnings: string[] = [];
    const runtime = start({
      warn: (...args: unknown[]) => {
        warnings.push(String(args[0]));
      },
    });

    await connectThenEdit({ title: 'Typed in the admin' }, { title: 'Typed again' });

    // LP0808 once for the session, with both ways out named.
    const said = warnings.filter((line) => line.includes('LP0808'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('1 field(s) fell short');
    expect(said[0]).toContain('routeStrategy: true');
    expect(said[0]).toContain("onUnfaithfulPatch: 'warn' to keep the patch and say so");

    // The consumer's markup survives, exactly as before Z3.
    expect(document.querySelector('.mark')?.textContent).toBe('Server rendered');
    // What `inspect()` says on that page: the patch fell short, nothing was
    // asked to redraw it, and `route.handler` beside it says why.
    const { fidelity, route } = runtime.inspect();
    expect(fidelity).toEqual({
      mode: 'escalate',
      canEscalate: false,
      unfaithful: 1,
      escalated: 0,
      fields: ['title'],
    });
    expect(route.handler).toBe(false);
    runtime.destroy();
  });
});

/**
 * Z2 keeps the server's markup for a block with no renderer by pairing each
 * placeholder with the live element in its position. Where the two trees do not
 * line up there is nothing to pair, the empty placeholder is written, and the
 * server's subtree is gone — the one case Z2 left as a known degradation. (A
 * wrapper around the field was that case until Z29; a paragraph the server
 * dropped still is.)
 */
describe('a Lexical block whose markup the write cannot keep', () => {
  const SERVER_MARKUP =
    '<p>intro</p>' + '<figure><img src="https://cdn.example.com/a.jpg" alt="a"></figure>';

  function documentWith(intro: string): Record<string, unknown> {
    return {
      content: {
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: intro }] },
            { type: 'block', fields: { blockType: 'mediaBlock', media: { id: 7 } } },
            { type: 'paragraph', children: [{ type: 'text', text: 'outro' }] },
          ],
        },
      },
    };
  }

  it('refreshes the route instead of leaving an empty placeholder behind', async () => {
    __resetBlockRegistryForTests();
    // The server dropped the empty outro paragraph: two live children against
    // three rendered ones, so the descent stops before it reaches the placeholder.
    document.body.innerHTML = `<div data-payload-field="content">${SERVER_MARKUP}</div>`;
    const route = fakeRoute();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = start({ strategies: { route }, warn: () => {} });

    fireMessage({ type: 'payload-live-preview', data: documentWith('intro') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('.lp-block--mediablock')).not.toBeNull();
    expect(route.refreshes).toBe(1);
    warn.mockRestore();
    runtime.destroy();
  });

  it('stays quiet when every placeholder found its live element', async () => {
    __resetBlockRegistryForTests();
    document.body.innerHTML =
      '<div data-payload-field="content">' +
      '<p>intro</p>' +
      '<figure><img src="https://cdn.example.com/a.jpg" alt="a"></figure>' +
      '<p>outro</p>' +
      '</div>';
    const route = fakeRoute();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = start({ strategies: { route }, warn: () => {} });

    fireMessage({ type: 'payload-live-preview', data: documentWith('intro') });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: documentWith('edited') });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/a.jpg',
    );
    expect(route.refreshes).toBe(0);
    warn.mockRestore();
    runtime.destroy();
  });
});

/**
 * The unbound change — a field the page has no anchor for, and a section the
 * template renders only under a condition, which is the same fact seen from the
 * template's side. 2.0 needed `onUnboundChange: 'route'` for this; it is now
 * what the runtime does unless it is told otherwise.
 */
describe('a changed field with no binding', () => {
  it('refreshes the route without being asked to', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const route = fakeRoute();
    const runtime = start({ strategies: { route } });

    await connectThenEdit({ title: 'Server rendered', callout: 'the section is not on the page' });

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it("is off again when the 2.0 name says 'ignore'", async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, onUnboundChange: 'ignore' });

    await connectThenEdit({ title: 'Server rendered', callout: 'the section is not on the page' });

    expect(route.refreshes).toBe(0);
    runtime.destroy();
  });

  it("keeps working when the 2.0 name says 'route'", async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, onUnboundChange: 'route' });

    await connectThenEdit({ title: 'Server rendered', callout: 'the section is not on the page' });

    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  /**
   * Testlauf B, F1: the route refreshed and the editor saw the edit, but
   * `inspect().fidelity` reported nothing at all — on exactly the page the
   * reading exists for. Only the element path reached the ledger, and a field
   * with no binding has no element, so it went past it in every mode.
   */
  it('counts the finding, and the escalation that answered it', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, warn: () => {} });

    await connectThenEdit({ title: 'Server rendered', callout: 'the section is not on the page' });

    expect(route.refreshes).toBe(1);
    expect(runtime.inspect().fidelity).toEqual({
      mode: 'escalate',
      canEscalate: true,
      unfaithful: 1,
      escalated: 1,
      fields: ['callout'],
    });
    runtime.destroy();
  });

  it('counts it on a page with nowhere to escalate to, which is the page it is for', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const runtime = start({ warn: () => {} });

    await connectThenEdit({ title: 'Server rendered', callout: 'the section is not on the page' });

    const { fidelity, route } = runtime.inspect();
    expect(fidelity).toEqual({
      mode: 'escalate',
      canEscalate: false,
      unfaithful: 1,
      escalated: 0,
      fields: ['callout'],
    });
    expect(route.handler).toBe(false);
    runtime.destroy();
  });

  it("counts it under 'warn' and under 'ignore', where nothing is done about it", async () => {
    for (const mode of ['warn', 'ignore'] as const) {
      document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
      const route = fakeRoute();
      const runtime = start({ strategies: { route }, onUnfaithfulPatch: mode, warn: () => {} });

      await connectThenEdit({ title: 'Server rendered', callout: 'nothing binds this' });

      expect(route.refreshes).toBe(0);
      expect(runtime.inspect().fidelity).toEqual({
        mode,
        canEscalate: true,
        unfaithful: 1,
        escalated: 0,
        fields: ['callout'],
      });
      runtime.destroy();
    }
  });

  it('counts one finding per field, however often it is edited', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
    const route = fakeRoute();
    const runtime = start({ strategies: { route }, warn: () => {} });

    await connectThenEdit(
      { title: 'Server rendered', callout: 'one' },
      { title: 'Server rendered', callout: 'two' },
      { title: 'Server rendered', callout: 'three' },
    );

    expect(runtime.inspect().fidelity).toMatchObject({ unfaithful: 1, fields: ['callout'] });
    runtime.destroy();
  });
});
