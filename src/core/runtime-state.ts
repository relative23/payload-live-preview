/**
 * What the runtime owns for its lifetime (`RuntimeDeps`) and what changes as it
 * runs (`RuntimeState`). Both are shared by the pipeline collaborators.
 */

import type { PayloadFieldSchema, PayloadLivePreviewMessage } from '@/types/payload-protocol';
import type { EventEmitter } from '@events/emitter';
import type { SchemaIndex } from '@schema/index';
import type { SanitizerPolicyMode } from '@security/sanitizer';
import type { A11yAnnouncer } from './a11y';
import type { ElementCache } from './cache';
import type { DataMerger } from './data-merger';
import type { UnfaithfulPatchMode } from './fidelity';
import { FieldChangeTracker } from './field-changes';
import { MergeNeed } from './merge-need';
import type { MessageBus, MessageRevision } from './message-bus';
import type { ObserverManager } from './observers';
import { ProtocolTracker } from './protocol-tracker';
import { RelationshipTracker } from './relationship-tracker';
import { FieldRevealer } from './reveal';
import { RevealLedger } from './reveal-ledger';
import type { RuntimeOptions } from './runtime-options';
import type { ConnectionState, HeartbeatTimer } from './state';
import type { StrategyHandlers } from './strategies';
import type { CachedElement, FieldRenderer, RichTextRenderer } from './types';
import type { FlushStats, UpdateScheduler } from './update-scheduler';

/** One accepted message on its way to the DOM. See ADR 0004. */
export interface UpdateTransaction {
  readonly revision: MessageRevision;
  readonly message: PayloadLivePreviewMessage;
  readonly locale: string | undefined;
  readonly schema: readonly PayloadFieldSchema[] | undefined;
  readonly schemaIndex: SchemaIndex | undefined;
  readonly receivedAt: number;
  /** A save in another document may change populated values only, so render everything. */
  readonly forceRender: boolean;
  /** Top-level fields whose value changed since the previous message, plus their dependents. */
  touched: ReadonlySet<string>;
  /** The connection's first message, where every field counts as changed. */
  baseline: boolean;
  /** Dependents of changed fields; re-applied even when their own value is unchanged. */
  invalidated: ReadonlySet<string>;
  /**
   * First binding whose value changed; revealed once its write landed. The
   * binding itself, not its field name: several documents on one page share
   * field names, and only this one belongs to the edited document.
   */
  revealTarget: CachedElement | undefined;
  /**
   * Identities the reveal ledger will record once this revision reaches its
   * reveal point — not before. A revision superseded on the way there never
   * revealed, so the ledger must still show the previous value: the message
   * that supersedes it is then the one that owes the reveal.
   */
  revealIdentities: [key: string, identity: string][];
  pendingFragments: number;
  routeRefreshed: boolean;
  cancelled: boolean;
  /** Terminal: the scheduled writes reached the DOM (or there were none). */
  completed: boolean;
}

export interface RuntimeDeps {
  readonly emitter: EventEmitter;
  readonly cache: ElementCache;
  readonly observers: ObserverManager;
  readonly scheduler: UpdateScheduler;
  readonly bus: MessageBus;
  readonly connection: ConnectionState;
  readonly heartbeat: HeartbeatTimer;
  readonly renderers: Readonly<Record<string, FieldRenderer>>;
  readonly resolveRenderer: NonNullable<RuntimeOptions['resolveRenderer']>;
  readonly transformValue: RuntimeOptions['transformValue'];
  readonly renderRichText: RichTextRenderer | undefined;
  readonly sanitizerPolicy: SanitizerPolicyMode | undefined;
  readonly root: Document | Element;
  readonly readyTargets: () => readonly string[];
  readonly sendReady: (origins: readonly string[]) => void;
  readonly onHeartbeatTimeout: RuntimeOptions['onHeartbeatTimeout'];
  readonly log: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly a11y: A11yAnnouncer | null;
  readonly merger: DataMerger | null;
  /** How long a burst of messages may share one merge; the scheduler's debounce window. */
  readonly mergeWindowMs: number;
  readonly scopeBindingsByOwner: boolean;
  readonly lockedOrigin: () => string | undefined;
  readonly skipUnchanged: boolean;
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  readonly strategies: StrategyHandlers;
  readonly revealEditedField: boolean;
  /** What to do about a patch the runtime knows cannot match the server's render. */
  readonly onUnfaithfulPatch: UnfaithfulPatchMode;
}

export class RuntimeState {
  started = false;
  /** Set by `suspend()`; lets `destroy()` finish a suspended instance. */
  suspended = false;
  deferredStart: (() => void) | null = null;
  activeUpdate: UpdateTransaction | null = null;
  locale: string | undefined = undefined;
  schema: readonly PayloadFieldSchema[] | undefined = undefined;
  schemaIndex: SchemaIndex | undefined = undefined;
  updateCount = 0;
  supersededCount = 0;
  completedCount = 0;
  skippedUnchangedCount = 0;
  lastFlush: FlushStats | null = null;
  readonly absentFields = new Set<string>();
  readonly warnedOrphanFields = new Set<string>();
  readonly warnedStrategy = new WeakSet<Element>();
  warnedUnattributableMessage = false;
  warnedVisibilityGate = false;
  warnedFragmentFallback = false;
  /** LP0503 is reported once: a drifting sender repeats the same shape on every keystroke. */
  warnedProtocolShape = false;
  /** LP0411 is reported once per element; the markup that causes it does not change. */
  readonly reportedUnfaithful = new WeakSet<Element>();
  /** Bindings this revision could not patch faithfully, drained by the flush that escalates them. */
  unfaithfulPatches: CachedElement[] = [];
  /** Identity of the value each element last applied; reset when the markup is re-rendered. */
  lastAppliedIdentity = new WeakMap<Element, string>();
  /** What each owned field was last seen with, for the reveal decision only. */
  readonly revealLedger = new RevealLedger();
  readonly fragmentStats = { rendered: 0, failed: 0, superseded: 0 };
  readonly routeStats = { refreshes: 0, failed: 0, refused: 0, loopStopped: 0 };
  fragmentController: AbortController | null = null;
  routeController: AbortController | null = null;
  /** The trailing run a refused refresh asked for; at most one, and always the newest. */
  routeRetry: ReturnType<typeof setTimeout> | null = null;
  readonly readyTimers: ReturnType<typeof setTimeout>[] = [];
  readonly revealer = new FieldRevealer();
  readonly changes = new FieldChangeTracker();
  readonly merges = new MergeNeed();
  readonly protocol = new ProtocolTracker();
  readonly relationships = new RelationshipTracker();

  /** Read through a method: TypeScript keeps a narrowed `started` across the calls that can flip it. */
  isRunning(): boolean {
    return this.started;
  }

  /** Whether `transaction` may still touch the DOM; re-checked after every reentrant callback. */
  isCurrent(transaction: UpdateTransaction): boolean {
    return this.started && this.activeUpdate === transaction;
  }

  complete(transaction: UpdateTransaction): void {
    if (transaction.completed) return;
    transaction.completed = true;
    this.completedCount += 1;
  }

  /**
   * Abort in-flight strategy work; a newer revision or a stop supersedes it.
   * The trailing route refresh goes with it: the revision that asked for it is
   * no longer the one on screen, and the newer one decides for itself — its
   * message carries the older one's values too.
   */
  abortStrategies(): void {
    if (this.routeRetry !== null) {
      clearTimeout(this.routeRetry);
      this.routeRetry = null;
    }
    for (const key of ['fragmentController', 'routeController'] as const) {
      const controller = this[key];
      if (controller === null) continue;
      this[key] = null;
      controller.abort();
    }
  }
}
