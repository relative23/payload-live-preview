/**
 * What the runtime owns for its lifetime (`RuntimeDeps`) and what changes as it
 * runs (`RuntimeState`). Both are shared by the pipeline collaborators.
 */

import type { PayloadFieldSchema, PayloadLivePreviewMessage } from '@/types/payload-protocol';
import type { EventEmitter } from '@events/emitter';
import type { SchemaIndex } from '@schema/index';
import type { A11yAnnouncer } from './a11y';
import type { ElementCache } from './cache';
import type { DataMerger } from './data-merger';
import { FieldChangeTracker } from './field-changes';
import type { MessageBus, MessageRevision } from './message-bus';
import type { ObserverManager } from './observers';
import { ProtocolTracker } from './protocol-tracker';
import { FieldRevealer } from './reveal';
import type { RuntimeOptions } from './runtime-options';
import type { ConnectionState, HeartbeatTimer } from './state';
import type { StrategyHandlers } from './strategies';
import type { CachedElement, FieldRenderer, RichTextRenderer } from './types';
import type { FlushStats, UpdateScheduler } from './update-scheduler';

/** One accepted message on its way to the DOM. See ADR 0004. */
export interface UpdateTransaction {
  readonly identity: MessageRevision;
  readonly message: PayloadLivePreviewMessage;
  readonly locale: string | undefined;
  readonly schema: readonly PayloadFieldSchema[] | undefined;
  readonly schemaIndex: SchemaIndex | undefined;
  readonly receivedAt: number;
  /** A relationship edit may change populated values only, so render everything. */
  readonly forceRender: boolean;
  /** Top-level fields whose value changed since the previous message, plus their dependents. */
  touched: ReadonlySet<string>;
  /** Dependents of changed fields; re-applied even when their own value is unchanged. */
  invalidated: ReadonlySet<string>;
  /**
   * First binding whose value changed; revealed once its write landed. The
   * binding itself, not its field name: several documents on one page share
   * field names, and only this one belongs to the edited document.
   */
  revealTarget: CachedElement | undefined;
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
  readonly root: Document | Element;
  readonly readyTargets: () => readonly string[];
  readonly sendReady: (origins: readonly string[]) => void;
  readonly onHeartbeatTimeout: RuntimeOptions['onHeartbeatTimeout'];
  readonly log: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly a11y: A11yAnnouncer | null;
  readonly merger: DataMerger | null;
  readonly scopeBindingsByOwner: boolean;
  readonly lockedOrigin: () => string | undefined;
  readonly skipUnchanged: boolean;
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  readonly strategies: StrategyHandlers;
  readonly revealEditedField: boolean;
}

export function sameRevision(a: MessageRevision, b: MessageRevision): boolean {
  return a.generation === b.generation && a.revision === b.revision;
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
  /** Identity of the value each element last applied; reset when the markup is re-rendered. */
  lastAppliedIdentity = new WeakMap<Element, string>();
  /**
   * Identity of the value last seen per owned field, for the reveal decision
   * only. Keyed by document and field rather than by element, so a field the
   * server re-renders behind a fragment boundary — where no element survives
   * to carry the identity — is still known to have changed.
   */
  readonly seenFieldIdentity = new Map<string, string>();
  readonly fragmentStats = { rendered: 0, failed: 0, superseded: 0 };
  readonly routeStats = { refreshes: 0, failed: 0, loopStopped: 0 };
  fragmentController: AbortController | null = null;
  routeController: AbortController | null = null;
  readonly readyTimers: ReturnType<typeof setTimeout>[] = [];
  readonly revealer = new FieldRevealer();
  readonly changes = new FieldChangeTracker();
  readonly protocol = new ProtocolTracker();

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

  /** Abort in-flight strategy work; a newer revision or a stop supersedes it. */
  abortStrategies(): void {
    for (const key of ['fragmentController', 'routeController'] as const) {
      const controller = this[key];
      if (controller === null) continue;
      this[key] = null;
      controller.abort();
    }
  }
}
