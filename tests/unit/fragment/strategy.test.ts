/**
 * The orchestration over a per-boundary handler: what the strategy does with an
 * element that stopped being a boundary before its render started, and with a
 * failure whose report supersedes the revision. What a request carries and how
 * a response is judged is in `client.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FragmentContext } from '@core/strategies/strategies';
import { fragmentStrategyFrom, type FragmentHandler } from '@fragment/index';

function boundaryElement(id: string): Element {
  const element = document.createElement('section');
  element.setAttribute('data-payload-fragment', id);
  return element;
}

function context(overrides: Partial<FragmentContext> = {}): FragmentContext {
  return {
    root: document,
    revision: 7,
    receivedAt: 1,
    fields: { title: 'T' },
    locale: undefined,
    collectionSlug: undefined,
    globalSlug: 'home',
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: vi.fn(),
    morph: vi.fn(),
    patch: vi.fn(),
    rendered: vi.fn(),
    failed: vi.fn(),
    ...overrides,
  };
}

describe('fragmentStrategyFrom', () => {
  it('leaves out an element that is no longer a boundary when the render starts', async () => {
    const handler = vi.fn<FragmentHandler>(() =>
      Promise.resolve({ status: 'rendered', html: '<h1>S</h1>' }),
    );
    const morph = vi.fn();
    const stale = document.createElement('section');
    const live = boundaryElement('hero');

    const report = await fragmentStrategyFrom(handler).render(context({ morph }), [stale, live]);

    expect(report).toEqual({ rendered: 1, failed: 0, superseded: 0 });
    expect(handler).toHaveBeenCalledOnce();
    expect(morph).toHaveBeenCalledWith(live, '<h1>S</h1>');
  });

  it('counts a superseded outcome, and a render that lands after its revision ended, as superseded and writes nothing', async () => {
    const written = { morph: vi.fn(), patch: vi.fn(), rendered: vi.fn(), failed: vi.fn() };
    const superseded: FragmentHandler = () => Promise.resolve({ status: 'superseded' });
    const late: FragmentHandler = () => Promise.resolve({ status: 'rendered', html: '<h1>S</h1>' });

    const whileCurrent = await fragmentStrategyFrom(superseded).render(context(written), [
      boundaryElement('hero'),
    ]);
    const afterTheEnd = await fragmentStrategyFrom(late).render(
      context({ ...written, isCurrent: () => false }),
      [boundaryElement('hero')],
    );

    expect(whileCurrent).toEqual({ rendered: 0, failed: 0, superseded: 1 });
    expect(afterTheEnd).toEqual({ rendered: 0, failed: 0, superseded: 1 });
    for (const write of Object.values(written)) expect(write).not.toHaveBeenCalled();
  });

  it('does not patch a failed boundary once reporting the failure superseded the revision', async () => {
    let current = true;
    const patch = vi.fn();
    const handler: FragmentHandler = () =>
      Promise.resolve({ status: 'failed', code: 'LP0801', reason: 'the server said no' });

    const report = await fragmentStrategyFrom(handler).render(
      context({
        isCurrent: () => current,
        patch,
        // The report runs consumer listeners, and one of them may accept a newer revision.
        failed: () => {
          current = false;
        },
      }),
      [boundaryElement('hero')],
    );

    expect(patch).not.toHaveBeenCalled();
    expect(report).toEqual({ rendered: 0, failed: 1, superseded: 0 });
  });
});
