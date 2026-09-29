/**
 * How completely the page shows one revision (ADR 0023). The session counters
 * say what happened over a session; this says, for the revision in flight,
 * whether work is outstanding and which step fell short, so a host does not
 * have to attribute route outcomes and fragment fallbacks itself.
 */

import type { DiagnosticCode } from './diagnostic-codes';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import { FRAGMENT_ATTRIBUTE, FRAGMENT_KEY_ATTRIBUTE, type RouteOutcome } from './strategies';

/** Where a revision stands: work left, shown, shown with shortfalls, awaiting an island, or replaced (ADR 0023). */
export type RevisionDisplayState = 'pending' | 'current' | 'partial' | 'unconfirmed' | 'superseded';

/** One step that kept a settled revision from being current. */
export type RevisionShortfall =
  | {
      readonly kind: 'fragment';
      readonly id: string;
      readonly key: string | undefined;
      readonly code: DiagnosticCode;
    }
  | { readonly kind: 'route-saved' }
  | { readonly kind: 'route-failed'; readonly outcome: RouteOutcome }
  | { readonly kind: 'unfaithful' | 'unbound'; readonly field: string }
  | { readonly kind: 'write'; readonly field: string; readonly code: DiagnosticCode }
  | { readonly kind: 'merge' };

/** How completely the page shows one accepted revision (ADR 0023). */
export interface RevisionDisplay {
  /** The message revision this record is about. */
  readonly revision: number;
  /** `pending` while work is left; the other states once it settled. */
  readonly state: RevisionDisplayState;
  /** What kept a settled revision from being current; empty unless `state` is `partial`. */
  readonly shortfalls: readonly RevisionShortfall[];
  /** Writes the visibility gate holds until their element is seen; they count as landed. */
  readonly deferred: number;
  /** Islands the revision was handed to that have not called `displayed()`. */
  readonly awaitingIslands: number;
}

/** What the ledger asks of the runtime: whether work is left, where a settled state goes, and where a failure to say it goes. */
export interface RevisionDisplayHost<K> {
  readonly outstanding: (key: K) => boolean;
  readonly report: (display: RevisionDisplay) => void;
  readonly failed: (error: unknown) => void;
}

interface Entry<K> {
  readonly key: K;
  readonly revision: number;
  readonly shortfalls: RevisionShortfall[];
  readonly seen: Set<string>;
  deferred: number;
  awaiting: number;
  reported: RevisionDisplayState | undefined;
  queued: boolean;
}

/** What an older revision's island is handed: its confirmation no longer counts. */
const IGNORED = (): void => undefined;

export class RevisionDisplayLedger<K extends object> {
  host: RevisionDisplayHost<K> = { outstanding: () => false, report: IGNORED, failed: IGNORED };
  private entry: Entry<K> | null = null;

  /**
   * A newer revision was accepted. The one before it reports now: superseded
   * if it had work left, otherwise the state it reached and had not yet said.
   */
  begin(key: K, revision: number): void {
    const previous = this.entry;
    if (previous !== null) {
      const view = this.view(previous);
      this.publish(previous, view.state === 'pending' ? { ...view, state: 'superseded' } : view);
    }
    this.entry = {
      key,
      revision,
      shortfalls: [],
      seen: new Set(),
      deferred: 0,
      awaiting: 0,
      reported: undefined,
      queued: false,
    };
  }

  /** The latest accepted revision's record, as `inspect()` reads it. */
  snapshot(): RevisionDisplay | undefined {
    return this.entry === null ? undefined : this.view(this.entry);
  }

  /** Record a shortfall against `key` while it is the latest revision; the same one twice counts once. */
  shortfall(key: K | null, shortfall: RevisionShortfall): void {
    const entry = this.entry;
    if (entry?.key !== key) return;
    const id = JSON.stringify(shortfall);
    if (entry.seen.has(id)) return;
    entry.seen.add(id);
    entry.shortfalls.push(shortfall);
    this.requestSettle(entry.key);
  }

  /** How many of the revision's writes the visibility gate holds, as of its latest flush. */
  deferred(key: K, count: number): void {
    if (this.entry?.key === key) this.entry.deferred = count;
  }

  /**
   * An island is handed the revision; the returned callback is its
   * `displayed()`. Late, repeated or superseded calls do nothing.
   */
  handIsland(key: K): () => void {
    const entry = this.entry;
    if (entry?.key !== key) return IGNORED;
    entry.awaiting += 1;
    let confirmed = false;
    return () => {
      if (confirmed || this.entry !== entry) return;
      confirmed = true;
      entry.awaiting -= 1;
      this.settle(entry);
    };
  }

  /**
   * Look again once the current task's synchronous work is done: a flush
   * hands islands the revision after it completes, and those count.
   */
  requestSettle(key: K): void {
    const entry = this.entry;
    if (entry?.key !== key || entry.queued) return;
    entry.queued = true;
    queueMicrotask(() => {
      entry.queued = false;
      // Nothing awaits this task: a throw would reach no one but the console.
      try {
        if (this.entry === entry) this.settle(entry);
      } catch (error) {
        this.host.failed(error);
      }
    });
  }

  private settle(entry: Entry<K>): void {
    const view = this.view(entry);
    if (view.state !== 'pending') this.publish(entry, view);
  }

  private publish(entry: Entry<K>, view: RevisionDisplay): void {
    if (entry.reported === view.state) return;
    entry.reported = view.state;
    this.host.report(view);
  }

  private view(entry: Entry<K>): RevisionDisplay {
    // Only the latest entry is viewed; `begin` alone says `superseded`.
    const state: RevisionDisplayState = this.host.outstanding(entry.key)
      ? 'pending'
      : entry.shortfalls.length > 0
        ? 'partial'
        : entry.awaiting > 0
          ? 'unconfirmed'
          : 'current';
    return {
      revision: entry.revision,
      state,
      shortfalls: [...entry.shortfalls],
      deferred: entry.deferred,
      awaitingIslands: entry.awaiting,
    };
  }
}

/**
 * The runtime's answer to "is work left": a revision not yet complete, a
 * boundary still rendering, a route refresh in flight or held back by its
 * window, or writes not flushed. The route counts for whichever revision is
 * current, because it lands for that one (ADR 0004 §4d).
 */
export function runtimeDisplayHost(
  deps: Pick<RuntimeDeps, 'scheduler' | 'emitter' | 'a11y' | 'log'>,
  state: Pick<RuntimeState, 'routeController' | 'routeRetry'>,
): RevisionDisplayHost<UpdateTransaction> {
  return {
    outstanding: (transaction) =>
      !transaction.completed ||
      transaction.pendingFragments > 0 ||
      state.routeController !== null ||
      state.routeRetry !== null ||
      deps.scheduler.pendingCount > 0,
    report: (display) => {
      if (display.state === 'partial') deps.a11y?.announcePartial();
      void deps.emitter.emit('revisionDisplay', display);
    },
    failed: (error) => {
      deps.log('revision display failed:', error);
    },
  };
}

/** A strategy that threw renders none of its boundaries; each fell back to a patch (LP0801). */
export function thrownFragment(boundary: Element): RevisionShortfall {
  const key = boundary.getAttribute(FRAGMENT_KEY_ATTRIBUTE);
  return {
    kind: 'fragment',
    id: boundary.getAttribute(FRAGMENT_ATTRIBUTE) ?? '',
    key: key === null || key.length === 0 ? undefined : key,
    code: 'LP0801',
  };
}
