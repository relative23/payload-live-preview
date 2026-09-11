/**
 * Waiting for React before the first write (ADR 0015).
 *
 * A page a framework hydrates is not final when it is parsed: the client
 * bundle arrives later, walks the server markup and compares it with what it
 * would have rendered. A value the runtime wrote in between is a mismatch —
 * React 19 throws, discards the tree under the nearest Suspense boundary,
 * renders it again on the client, and the write is gone with it. Measured on
 * the Next fixture on 2026-09-11: the write at 93 ms, React's fiber on the
 * bound element at 174 ms, `Hydration failed` at 180 ms.
 *
 * Neither Next nor React says when hydration is done. What React does expose,
 * since 16 and for its own DevTools, is its instrumentation protocol: when
 * `react-dom` evaluates it looks for `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`,
 * calls `inject()` if the hook says `supportsFiber`, and from then on
 * `onCommitFiberRoot(rendererId, root)` after every commit — each call guarded
 * by `typeof … === 'function'` and a `try`. The first commit of a root that
 * holds a binding is the moment React has taken the markup over; everything
 * before it is too early, and a commit into a root without a binding (Next's
 * dev overlay commits three times before the app does) is not ours to wait for.
 *
 * Two bundles read this: the runtime, which arms the hook when it starts, and
 * the bootstrap for asset delivery (`./loader`, built armed), where the runtime
 * itself is fetched and may evaluate after `react-dom`. They share one window
 * slot, read late, the way the route-refresh seam does.
 */

/** The framework whose first commit the start waits for; `./hydration-vue` reads the second. */
export type HydrationMode = 'react' | 'vue';
export type HydrationOutcome = 'committed' | 'timed-out';
export type HydrationState = 'idle' | 'waiting' | HydrationOutcome;

/**
 * How long the runtime waits for the commit before it starts anyway and says
 * so (LP0607). A page whose React never commits is broken; a preview that never
 * connects would hide that, one that connects five seconds late and says why
 * does not. A hydration slower than this regenerates the tree once, as before.
 */
export const HYDRATION_WAIT_CAP_MS = 5000;

/** Where the prelude and the runtime meet. */
export const HYDRATION_SLOT = '__livePreviewHydration';

/**
 * `[data-payload-field]`, spelled out rather than imported from `./cache`: the
 * armed bootstrap bundles this module beside the loader, and the import dragged
 * the cache's other selectors into a script that is measured to the byte. A
 * test holds it equal to `FIELD_ATTRIBUTE`.
 */
export const BINDING_SELECTOR = '[data-payload-field]';

/**
 * What the two bundles share. The bootstrap only records: every container
 * React committed into goes to `commits` until the runtime, which alone knows
 * what a binding is, sets `onCommit` and judges the backlog and everything
 * after. Recording rather than judging keeps the armed bootstrap to the bytes
 * the delivery budgets hold a bootstrap to.
 */
interface HydrationSignal extends HydrationWait {
  armed: boolean;
  commits: unknown[];
  onCommit: ((container: unknown) => void) | undefined;
}

/**
 * What a wait shares whichever framework it is for: whether the framework has
 * taken the tree over, and who is waiting to hear it. The Vue observer keeps
 * one of its own (`./hydration-vue`); the cap and the cancel are the same.
 */
export interface HydrationWait {
  committed: boolean;
  waiters: (() => void)[];
}

/** The root React hands the hook after a commit; `containerInfo` is the DOM node it rendered into. */
interface FiberRootLike {
  readonly containerInfo?: unknown;
}

/**
 * The part of React's hook this module touches; the rest belongs to React and
 * its DevTools. React itself guards every other call it makes on the hook with
 * `typeof … === 'function'`; Fast Refresh (`react-refresh`, which every
 * development server runs) additionally walks `renderers` when it attaches,
 * and throws on a hook without the map — measured on the Next fixture, where
 * a hook without it stopped the page from hydrating at all.
 */
interface DevToolsHook {
  supportsFiber?: boolean;
  renderers?: Map<number, unknown>;
  inject?: (internals: unknown) => number;
  onCommitFiberRoot?: (
    this: unknown,
    rendererId: number,
    root?: FiberRootLike,
    ...rest: unknown[]
  ) => void;
}

type HookWindow = Window & {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook;
  [HYDRATION_SLOT]?: HydrationSignal;
};

function signalSlot(): HydrationSignal | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as HookWindow;
  return (w[HYDRATION_SLOT] ??= {
    armed: false,
    committed: false,
    commits: [],
    onCommit: undefined,
    waiters: [],
  });
}

/**
 * Arm before React evaluates: install the hook React injects into when the
 * page has none, or wrap `onCommitFiberRoot` on the one that is there — the
 * React DevTools extension injects its own at `document_start`, and it keeps
 * working because the previous function runs first. Idempotent.
 */
export function armReactCommitSignal(): void {
  const signal = signalSlot();
  if (signal === undefined || signal.armed) return;
  signal.armed = true;
  const w = window as HookWindow;
  const hook = (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= installedHook());
  const previous = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (this: unknown, rendererId, root, ...rest) {
    try {
      previous?.call(this, rendererId, root, ...rest);
    } catch {
      // The DevTools backend's failure is not ours to propagate; React would
      // swallow it too.
    }
    const container = root?.containerInfo;
    if (signal.onCommit === undefined) signal.commits.push(container);
    else signal.onCommit(container);
  };
}

/**
 * The hook React finds when the page has none: what `injectInternals` reads
 * (`supportsFiber`, `inject`) and what Fast Refresh reads (`renderers`, kept
 * the way DevTools keeps it — one id per renderer, so the two React copies a
 * development server runs are not one to it).
 */
function installedHook(): DevToolsHook {
  const renderers = new Map<number, unknown>();
  return {
    supportsFiber: true,
    renderers,
    inject: (internals) => {
      const id = renderers.size + 1;
      renderers.set(id, internals);
      return id;
    },
  };
}

/** A Document, or a container with a binding inside — the tree the runtime writes into. */
function ownsBindings(container: unknown): boolean {
  const node = container as Partial<Pick<Element, 'nodeType' | 'querySelector'>> | null | undefined;
  return node?.nodeType === 9 || node?.querySelector?.(BINDING_SELECTOR) != null;
}

/** The framework has taken the tree over: every waiter hears it, once. */
export function settle(signal: HydrationWait): void {
  signal.committed = true;
  const waiters = signal.waiters;
  signal.waiters = [];
  for (const waiter of waiters) waiter();
}

function forget(signal: HydrationWait, waiter: () => void): void {
  const index = signal.waiters.indexOf(waiter);
  if (index >= 0) signal.waiters.splice(index, 1);
}

/**
 * Call back once the signal settles, or after `capMs` without it. Returns
 * `null` without calling back when it already has — a bfcache restore does
 * not wait again — and otherwise a cancel for a runtime that stops waiting.
 */
export function awaitSettled(
  signal: HydrationWait,
  onSettled: (outcome: HydrationOutcome) => void,
  capMs: number,
): (() => void) | null {
  if (signal.committed) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const waiter = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    onSettled('committed');
  };
  signal.waiters.push(waiter);
  timer = setTimeout(() => {
    timer = null;
    forget(signal, waiter);
    onSettled('timed-out');
  }, capMs);
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    forget(signal, waiter);
  };
}

/**
 * Call back once React has committed a root that holds a binding, or after
 * `capMs` without one. Arms the signal if nothing has yet.
 */
export function whenReactCommitted(
  onSettled: (outcome: HydrationOutcome) => void,
  capMs = HYDRATION_WAIT_CAP_MS,
): (() => void) | null {
  armReactCommitSignal();
  const signal = signalSlot();
  if (signal === undefined) return null;
  if (signal.onCommit === undefined) {
    // The runtime is the one that can judge a commit; the bootstrap may have
    // recorded some before it ran. The backlog first, then every commit live.
    const judge = (container: unknown): void => {
      if (!signal.committed && ownsBindings(container)) settle(signal);
    };
    signal.onCommit = judge;
    for (const container of signal.commits.splice(0)) judge(container);
  }
  return awaitSettled(signal, onSettled, capMs);
}
