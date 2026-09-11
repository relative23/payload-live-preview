/**
 * When the runtime may start: after the document has parsed, and on a page
 * that declares hydration after the framework's first commit — React's, or
 * Vue's mount — or the cap (ADR 0015).
 *
 * `lifecycle.ts` owns the resources a start acquires and how a failed one is
 * rolled back; this module owns only the waiting. It moved out when the
 * second wait pushed the lifecycle past its 500 lines, and it stays a chain of
 * plain functions over a small host so that a stage running after `start()`
 * has returned still rolls back and reports the way a synchronous failure
 * throws — the host's `later` is that seam, and `defer` is how `release()`
 * abandons whichever wait is in progress.
 */

import {
  HYDRATION_WAIT_CAP_MS,
  armReactCommitSignal,
  whenReactCommitted,
  type HydrationMode,
  type HydrationOutcome,
  type HydrationState,
} from './hydration';
import { armVueMountSignal, whenVueMounted } from './hydration-vue';

/** What the startup chain needs from the runtime. */
export interface StartupHost {
  readonly root: Document | Element;
  readonly hydration: HydrationMode | undefined;
  /** Whether the runtime is still meant to start; a stop in between abandons the chain. */
  isRunning(): boolean;
  /** Keeps the way to abandon the wait in progress, for `release()`. */
  defer(cancel: () => void): void;
  /** Runs a stage after `start()` has returned: a throw is rolled back and reported, not lost. */
  later(step: () => void): void;
  /** Records how far the wait for hydration got, for `inspect()`. */
  hydrated(state: HydrationState): void;
  warn(message: string): void;
  /** Acquires the resources; throws into the caller when synchronous. */
  startNow(): void;
}

/**
 * Synchronous when nothing is pending. Otherwise the host is handed a cancel
 * and the chain continues through `later` once the wait ends.
 */
export function startWhenReady(host: StartupHost): void {
  // Armed before anything defers: the framework may evaluate before DOMContentLoaded.
  if (host.hydration === 'react') armReactCommitSignal();
  else if (host.hydration === 'vue') armVueMountSignal();
  const { root } = host;
  if (!isDocumentRoot(root) || root.readyState !== 'loading') {
    startAfterParse(host);
    return;
  }
  const onReady = (): void => {
    if (!host.isRunning()) return;
    host.later(() => {
      startAfterParse(host);
    });
  };
  root.addEventListener('DOMContentLoaded', onReady, { once: true });
  host.defer(() => {
    root.removeEventListener('DOMContentLoaded', onReady);
  });
}

/** A page a framework hydrates is not final until the framework has committed. */
function startAfterParse(host: StartupHost): void {
  if (host.hydration === undefined) {
    host.startNow();
    return;
  }
  const onSettled = (outcome: HydrationOutcome): void => {
    host.later(() => {
      startHydrated(host, outcome);
    });
  };
  const pending =
    host.hydration === 'react'
      ? whenReactCommitted(onSettled)
      : whenVueMounted(host.root, onSettled);
  // Already committed — a bfcache restore does not wait again.
  if (pending === null) {
    startHydrated(host, 'committed');
    return;
  }
  host.defer(pending);
  host.hydrated('waiting');
}

function startHydrated(host: StartupHost, outcome: HydrationOutcome): void {
  host.hydrated(outcome);
  if (outcome === 'timed-out') {
    host.warn(
      `[live-preview] LP0607: no ${host.hydration === 'react' ? 'React commit' : 'Vue mount'} in ${String(HYDRATION_WAIT_CAP_MS)} ms; started without waiting for hydration.`,
    );
  }
  host.startNow();
}

/** Node types are stable across realms; global constructors are not. */
function isDocumentRoot(root: Document | Element): root is Document {
  return root.nodeType === 9;
}
