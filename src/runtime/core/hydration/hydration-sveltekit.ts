/**
 * Waiting for SvelteKit before the first write (ADR 0015, addendum of 2026-10-01).
 *
 * Svelte's hydration claims the server's nodes and then runs each template
 * effect once; `set_text` compares its value with the node's text and writes
 * its own where they differ. A value the runtime wrote before that is put back,
 * quietly, as Vue does. Measured on the SvelteKit fixture's `/navigation` under
 * eight Playwright workers on 2026-09-30: the runtime's write, then 4 to 20 ms
 * later the server's title on the same node, in 5 to 7 of 40 runs.
 *
 * Neither Svelte nor SvelteKit says when hydration is done. What SvelteKit's
 * generated root does (read in 2.0.0 and in 2.70.2, the fixture's) is render
 * its route announcer (`<div id="svelte-announcer">`) under `{#if mounted}`,
 * with `mounted` set in the root's `onMount`: after the tree below it has been
 * hydrated and its template effects have run. The element is state, not an
 * event, so a runtime that evaluates after the mount (asset delivery) finds it.
 *
 * A page served with `csr = false` has no client and never renders the
 * announcer; waiting for it would cost every such page the cap. SvelteKit's
 * start script assigns its global (`__sveltekit_dev`, `__sveltekit_<hash>`)
 * only on a page it will hydrate, and by `DOMContentLoaded` that classic
 * script has run, so a page without the global starts at once.
 */

import {
  HYDRATION_WAIT_CAP_MS,
  awaitSettled,
  settle,
  type HydrationOutcome,
  type HydrationWait,
} from './hydration';

/** The live region SvelteKit's root renders once it has mounted (`write_root.js`). */
export const SVELTEKIT_ANNOUNCER_ID = 'svelte-announcer';

/** What the global SvelteKit's start script assigns begins with (`get_global_name`). */
export const SVELTEKIT_GLOBAL_PREFIX = '__sveltekit_';

/** SvelteKit's client will run on this page: its start script left its global. */
function clientStarts(): boolean {
  return Object.keys(window).some((key) => key.startsWith(SVELTEKIT_GLOBAL_PREFIX));
}

/**
 * Call back once SvelteKit's root has mounted, its announcer in the document,
 * or after `capMs` without it. `null` when there is nothing to wait for: the
 * root has mounted already, or no SvelteKit client runs on the page.
 */
export function whenSvelteKitMounted(
  root: Document | Element,
  onSettled: (outcome: HydrationOutcome) => void,
  capMs = HYDRATION_WAIT_CAP_MS,
): (() => void) | null {
  // The announcer is the document's, whatever part of it the runtime binds.
  const page = root.ownerDocument ?? root;
  const mounted = (): boolean => page.querySelector(`#${SVELTEKIT_ANNOUNCER_ID}`) !== null;
  if (mounted() || !clientStarts()) return null;
  const signal: HydrationWait = { committed: false, waiters: [] };
  const observer = new MutationObserver(() => {
    if (!signal.committed && mounted()) settle(signal);
  });
  observer.observe(page, { childList: true, subtree: true });
  const cancel = awaitSettled(
    signal,
    (outcome) => {
      observer.disconnect();
      onSettled(outcome);
    },
    capMs,
  );
  return () => {
    observer.disconnect();
    cancel?.();
  };
}
