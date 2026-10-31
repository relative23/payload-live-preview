/**
 * Waiting for a page that says when it has hydrated (ADR 0015, addendum of
 * 2026-10-31). The React, Vue and SvelteKit waits each read a trace their
 * framework leaves; a page on any other host, or whose host left none, calls
 * `markHydrated()` instead. The page's bundle and the runtime are separate
 * scripts and either may run first, so the slot holds a state a late runtime
 * can still read rather than an event it could miss.
 */

import {
  HYDRATION_WAIT_CAP_MS,
  awaitSettled,
  settle,
  type HydrationOutcome,
  type HydrationWait,
} from './hydration';

/** Where the page's bundle and the runtime meet. */
export const MANUAL_HYDRATION_SLOT = '__livePreviewHydrated';

type SlotWindow = Window & { [MANUAL_HYDRATION_SLOT]?: HydrationWait };

function signalSlot(): HydrationWait | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as SlotWindow;
  return (w[MANUAL_HYDRATION_SLOT] ??= { committed: false, waiters: [] });
}

/**
 * Tell a runtime started with `hydration: 'manual'` that this page has hydrated, so its
 * first write lands on markup the framework keeps. Call it once your framework has
 * taken the page over; a later call changes nothing, and on a server it does nothing.
 */
export function markHydrated(): void {
  const signal = signalSlot();
  if (signal !== undefined) settle(signal);
}

/**
 * Call back once the page has marked itself hydrated, or after `capMs` without
 * it. `null` when there is nothing to wait for: the page has marked itself
 * already, or there is no window.
 */
export function whenMarkedHydrated(
  _root: Document | Element,
  onSettled: (outcome: HydrationOutcome) => void,
  capMs = HYDRATION_WAIT_CAP_MS,
): (() => void) | null {
  const signal = signalSlot();
  return signal === undefined ? null : awaitSettled(signal, onSettled, capMs);
}
