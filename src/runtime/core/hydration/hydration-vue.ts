/**
 * Waiting for Vue before the first write (ADR 0015, addendum of 2026-09-11).
 *
 * Vue's `hydrate()` walks the server markup and repairs what differs from its
 * own render, in place and quietly (development logs `Hydration completed but
 * contains mismatches.`). A value the runtime wrote before that is a mismatch
 * and is put back. Measured on the Nuxt fixture on 2026-09-11: the write at
 * 25.5 ms, hydration at 93.7 ms, the server's values back in the same tick;
 * what put them right again was the admin answering the runtime's second
 * `ready` at 500 ms — and a real admin answers `ready` once.
 *
 * Vue says nothing when it is done. What `runtime-core` does, in every build
 * and right after `hydrate()` has returned, is `rootContainer.__vue_app__ = app`
 * (`apiCreateApp.ts`, `mount`): the property Vue DevTools and `app.unmount()`
 * find the app by. The assignment is the signal. An accessor on
 * `Element.prototype` sees it without polling, files the app on the element
 * as an own property exactly as the assignment would have, and settles once
 * the container holds a binding — a widget mounted beside the page is not
 * ours to wait for. A runtime that evaluates after the mount (asset delivery)
 * finds the own property on an ancestor of its first binding instead, so no
 * armed bootstrap is needed: the signal is state, not an event.
 *
 * A Nuxt app hands its `$nuxt` on the same object, and a page whose setup
 * awaits real time hydrates its subtree only when the root Suspense resolves
 * (measured: `__vue_app__` at 494 ms, the subtree at 895 ms). Nuxt marks that
 * with `isHydrating`, cleared synchronously when the Suspense resolves and
 * before `app:suspense:resolve` runs — so an app still hydrating at the
 * mount is waited for through that hook, and one that is not settles at once.
 *
 * Not used, and why: `data-v-app` is set by `createApp().mount` only, never by
 * `createSSRApp()`'s (measured, and in `runtime-dom`); the DevTools hook
 * (`__VUE_DEVTOOLS_GLOBAL_HOOK__`, `app:init`) exists in development builds and
 * under `__VUE_PROD_DEVTOOLS__` only; a MutationObserver sees nothing on a
 * clean hydration; `window.useNuxtApp` is Nuxt's, set before the mount, and
 * `useNuxtApp()` needs Nuxt's context to answer from outside a component.
 */

import {
  BINDING_SELECTOR,
  HYDRATION_WAIT_CAP_MS,
  awaitSettled,
  settle,
  type HydrationOutcome,
  type HydrationWait,
} from './hydration';

/** Where runtime-core leaves the app on its container. */
export const VUE_APP_PROPERTY = '__vue_app__';

/** One slot on the window, so a second copy of the runtime shares the state rather than the accessor. */
export const VUE_HYDRATION_SLOT = '__livePreviewVueHydration';

/** The Nuxt hook that runs once the root Suspense has resolved, its subtree hydrated. */
const NUXT_HYDRATED_HOOK = 'app:suspense:resolve';

interface VueMountSignal extends HydrationWait {
  armed: boolean;
}

/** The two things read off a Nuxt app: whether it is still hydrating, and the hook that ends it. */
interface NuxtAppLike {
  readonly isHydrating?: boolean;
  readonly hook?: (name: string, fn: () => void) => unknown;
}

type VueWindow = Window & { [VUE_HYDRATION_SLOT]?: VueMountSignal };

function signalSlot(): VueMountSignal | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as VueWindow;
  return (w[VUE_HYDRATION_SLOT] ??= { armed: false, committed: false, waiters: [] });
}

/** Vue's assignment lands as an own property; only that counts, never the accessor. */
function mountedApp(node: Node): unknown {
  return Object.prototype.hasOwnProperty.call(node, VUE_APP_PROPERTY)
    ? (node as unknown as Record<string, unknown>)[VUE_APP_PROPERTY]
    : undefined;
}

/**
 * Arm before Vue mounts: the accessor on `Element.prototype` that turns the
 * mount into a signal. Idempotent, and it leaves a seam another copy of the
 * runtime — or a tool — already holds alone; the slot is shared either way,
 * and the accessor reads it live rather than closing over one.
 */
export function armVueMountSignal(): void {
  const signal = signalSlot();
  if (signal === undefined || signal.armed) return;
  signal.armed = true;
  const proto = Element.prototype;
  if (Object.getOwnPropertyDescriptor(proto, VUE_APP_PROPERTY) !== undefined) return;
  Object.defineProperty(proto, VUE_APP_PROPERTY, {
    configurable: true,
    get: () => undefined,
    set(this: Element, app: unknown) {
      Object.defineProperty(this, VUE_APP_PROPERTY, {
        value: app,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      const live = signalSlot();
      if (live === undefined || live.committed || this.querySelector(BINDING_SELECTOR) === null) {
        return;
      }
      settleOnceHydrated(live, app);
    },
  });
}

/** Mounted, and — for a Nuxt app whose Suspense is still pending — hydrated too. */
function settleOnceHydrated(signal: VueMountSignal, app: unknown): void {
  const nuxt = (app as { $nuxt?: NuxtAppLike } | null | undefined)?.$nuxt;
  if (nuxt?.isHydrating === true && typeof nuxt.hook === 'function') {
    nuxt.hook(NUXT_HYDRATED_HOOK, () => {
      if (!signal.committed) settle(signal);
    });
    return;
  }
  settle(signal);
}

/** Whether an app already sits on an ancestor of a binding under `root` — the runtime came after Vue. */
function mountedAround(root: Document | Element): boolean {
  for (let node = root.querySelector(BINDING_SELECTOR); node !== null; node = node.parentElement) {
    if (mountedApp(node) !== undefined) return true;
  }
  return false;
}

/**
 * Call back once Vue has mounted — and, on Nuxt, hydrated — an app around a
 * binding of `root`, or after `capMs` without one. Arms the signal if nothing
 * has yet; `null` when it already happened.
 */
export function whenVueMounted(
  root: Document | Element,
  onSettled: (outcome: HydrationOutcome) => void,
  capMs = HYDRATION_WAIT_CAP_MS,
): (() => void) | null {
  armVueMountSignal();
  const signal = signalSlot();
  if (signal === undefined) return null;
  if (!signal.committed && mountedAround(root)) settle(signal);
  return awaitSettled(signal, onSettled, capMs);
}
