import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_ATTRIBUTE } from '@core/cache';
import {
  BINDING_SELECTOR,
  HYDRATION_SLOT,
  HYDRATION_WAIT_CAP_MS,
  armReactCommitSignal,
  whenReactCommitted,
} from '@core/hydration';

/**
 * The seam ADR 0015 §2 describes: React's instrumentation protocol, read for
 * one fact — has React committed a root that holds our bindings? The tests
 * play React: they call the hook the way `react-dom` does (`inject`, then
 * `onCommitFiberRoot(rendererId, root)` after every commit) and never import
 * it, so what is asserted is the protocol and not a React version.
 */

interface Hook {
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
  inject?: (internals: unknown) => number;
  onCommitFiberRoot?: (
    rendererId: number,
    root: { containerInfo: Node },
    ...rest: unknown[]
  ) => void;
  onCommitFiberUnmount?: () => void;
  onPostCommitFiberRoot?: () => void;
  checkDCE?: () => void;
}

type HookWindow = Window & {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook;
  [HYDRATION_SLOT]?: unknown;
};

const win = window as HookWindow;

function hook(): Hook {
  const installed = win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (installed === undefined) throw new Error('no hook installed');
  return installed;
}

/** What React does after a commit: one call, renderer id first, the root second. */
function commit(containerInfo: Node): void {
  hook().onCommitFiberRoot?.(1, { containerInfo }, undefined, false);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main><h1 data-payload-field="title">Hello</h1></main>';
});

afterEach(() => {
  vi.useRealTimers();
  delete win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  win[HYDRATION_SLOT] = undefined;
  document.body.innerHTML = '';
});

describe('arming the signal', () => {
  it('installs a hook React will inject into when the page has none', () => {
    armReactCommitSignal();

    const installed = hook();
    expect(installed.supportsFiber).toBe(true);
    expect(typeof installed.onCommitFiberRoot).toBe('function');
    // React stores the returned id and hands it back on every commit, and
    // Fast Refresh walks `renderers` when it attaches — a development server
    // runs two React copies (the app and Next's dev overlay), so the ids must
    // differ and the map must hold both. Measured: a hook without the map
    // stopped the Next fixture from hydrating at all.
    const inject = installed.inject;
    if (inject === undefined) throw new Error('inject missing');
    const app = {};
    const overlay = {};
    const first = inject(app);
    const second = inject(overlay);
    expect(typeof first).toBe('number');
    expect(second).not.toBe(first);
    expect(installed.renderers?.get(first)).toBe(app);
    expect(installed.renderers?.get(second)).toBe(overlay);
    // Everything else React calls on a hook it guards with `typeof …
    // === 'function'` first, so nothing else is defined.
    expect(installed.onCommitFiberUnmount).toBeUndefined();
  });

  it('looks for bindings by the attribute the cache binds on', () => {
    expect(BINDING_SELECTOR).toBe(`[${FIELD_ATTRIBUTE}]`);
  });

  it('wraps the hook that is already there and keeps calling it with its arguments', () => {
    // The React DevTools extension injects at document_start, so on a page
    // with the extension its hook is the one we find (ADR 0015 F4).
    const previous = vi.fn();
    const existing: Hook = { supportsFiber: true, inject: () => 7, onCommitFiberRoot: previous };
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existing;

    armReactCommitSignal();
    const root = { containerInfo: document };
    hook().onCommitFiberRoot?.(7, root, 2, false);

    expect(win.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existing);
    expect(existing.inject?.({})).toBe(7);
    expect(previous).toHaveBeenCalledWith(7, root, 2, false);
    expect(previous.mock.instances[0]).toBe(existing);
  });

  it('arms once: a second call neither wraps again nor resets the state', () => {
    const previous = vi.fn();
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, onCommitFiberRoot: previous };
    const settled = vi.fn();

    armReactCommitSignal();
    armReactCommitSignal();
    whenReactCommitted(settled);
    commit(document);

    expect(previous).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });
});

describe('waiting for the commit', () => {
  it('settles on the first commit whose root holds a binding, and only once', () => {
    const settled = vi.fn();
    const cancel = whenReactCommitted(settled);
    expect(cancel).not.toBeNull();

    commit(document);
    commit(document);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('ignores a root whose container holds no binding — the dev overlay commits first', () => {
    // Measured 2026-09-11: Next's dev overlay commits three times into
    // `<nextjs-portal>` before the app's own root hydrates (ADR 0015 F3).
    const portal = document.createElement('nextjs-portal');
    document.body.appendChild(portal);
    const settled = vi.fn();
    whenReactCommitted(settled);

    commit(portal);
    expect(settled).not.toHaveBeenCalled();

    commit(document);
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('accepts an element root that contains a binding, not only the document', () => {
    // A React app mounted into `#root` hydrates that element, not the document.
    const main = document.querySelector('main');
    if (main === null) throw new Error('fixture missing');
    const settled = vi.fn();
    whenReactCommitted(settled);

    commit(main);

    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('answers with null once it has committed, so a later start does not wait', () => {
    whenReactCommitted(() => undefined);
    commit(document);

    const settled = vi.fn();
    const cancel = whenReactCommitted(settled);

    // Nothing to wait for and nothing to cancel: the caller starts at once,
    // and a callback that fired synchronously would only have to be told apart.
    expect(cancel).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('judges a commit the bootstrap recorded before the runtime subscribed', () => {
    // Under asset delivery the bootstrap arms in <head> and the runtime may
    // arrive after React has committed; the bootstrap only records, so the
    // runtime's first look at the slot has to be the judgement.
    armReactCommitSignal();
    commit(document);

    const settled = vi.fn();
    expect(whenReactCommitted(settled)).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps waiting when every recorded commit went into a root without a binding', () => {
    const portal = document.createElement('nextjs-portal');
    document.body.appendChild(portal);
    armReactCommitSignal();
    commit(portal);

    const settled = vi.fn();
    expect(whenReactCommitted(settled)).not.toBeNull();
    expect(settled).not.toHaveBeenCalled();
    commit(document);
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('times out at the cap and says which way it settled', () => {
    const settled = vi.fn();
    whenReactCommitted(settled, 100);

    vi.advanceTimersByTime(99);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(settled).toHaveBeenCalledWith('timed-out');
    // A commit after the cap is not reported: the waiter already had its answer.
    commit(document);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('defaults to a cap of five seconds', () => {
    const settled = vi.fn();
    whenReactCommitted(settled);

    vi.advanceTimersByTime(HYDRATION_WAIT_CAP_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledWith('timed-out');
    expect(HYDRATION_WAIT_CAP_MS).toBe(5000);
  });

  it('cancels: neither the commit nor the cap reaches a waiter that left', () => {
    const settled = vi.fn();
    const cancel = whenReactCommitted(settled, 100);
    cancel?.();

    commit(document);
    vi.advanceTimersByTime(100);

    expect(settled).not.toHaveBeenCalled();
  });

  it('serves two waiters from one commit, each once', () => {
    const first = vi.fn();
    const second = vi.fn();
    whenReactCommitted(first);
    whenReactCommitted(second);

    commit(document);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('survives a hook that throws in its own handler: ours still settles', () => {
    win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      onCommitFiberRoot: () => {
        throw new Error('devtools backend broke');
      },
    };
    const settled = vi.fn();
    whenReactCommitted(settled);

    // React wraps its call in try/catch; ours must not depend on the previous
    // handler returning normally.
    expect(() => {
      commit(document);
    }).not.toThrow();
    expect(settled).toHaveBeenCalledWith('committed');
  });
});
