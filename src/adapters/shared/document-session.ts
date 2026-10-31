/**
 * The document a framework hook exposes, kept outside any framework: the
 * message bus decides which windows may speak, `DataMerger` turns the admin's
 * raw form values back into a populated document, and this class holds the one
 * snapshot a `useSyncExternalStore`-shaped API reads.
 *
 * It touches no DOM. A hook that re-renders a component tree needs the data,
 * not the bindings — everything about elements lives in the runtime instead.
 *
 * The session is per instance (ADR 0002): two hooks on one page have two
 * mergers, two revisions and two snapshots, so a request or an error in one
 * never reaches the other. A session given a `document` merges only the
 * messages for that document; without one it follows the document the admin
 * sends, whichever document it started from.
 */

import { readDocumentId } from '@core/binding-owner';
import { DataMerger } from '@core/data-merger';
import { MessageBus } from '@core/message-bus';
import { PAYLOAD_2_HINT } from '@core/protocol-version';
import { isDevMode } from '@detection/environment';
import { OriginDetector } from '@detection/origin';
import type { PayloadFieldSchema, PayloadLivePreviewMessage } from '@/types/payload-protocol';

/**
 * `idle` — connected, nothing received yet. `live` — the newest update was
 * merged and is in `data`. `unavailable` — it could not be, and `data` is the
 * last good document rather than a half-merged one.
 */
export type DocumentStatus = 'idle' | 'live' | 'unavailable';

export interface DocumentSnapshot<T> {
  /** The newest document that merged; never a partially applied one. */
  readonly data: T;
  /** No update has settled yet, or a merge is in flight. */
  readonly isLoading: boolean;
  readonly status: DocumentStatus;
  /** Why the last update did not merge; `undefined` while `status` is not `unavailable`. */
  readonly error: Error | undefined;
  /**
   * Which of this session's messages `data` came from: `0` for the initial
   * data, and unchanged when a merge fails. The framework paints `data` in its
   * own commit; a component that must know it was painted compares this in an
   * effect (ADR 0023).
   */
  readonly revision: number;
}

/**
 * The document a session previews: a collection document by its id, or a global by its slug.
 * `locale` narrows it to the updates the admin sends for that locale.
 */
export type PreviewDocument =
  | { readonly collection: string; readonly id: string | number; readonly locale?: string }
  | { readonly global: string; readonly locale?: string };

export interface DocumentSessionOptions {
  /** Payload server origin the update is re-fetched from. */
  readonly serverURL: string;
  /** REST route prefix. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth for the merge. Default `1`, as Payload's own hook. */
  readonly depth?: number;
  /**
   * Milliseconds a merge may wait for the server; after that the update is `unavailable`
   * and `data` stays the last good document. Off by default: a merge waits as long as the
   * server takes.
   */
  readonly timeoutMs?: number;
  /**
   * Admin origins allowed to post updates. Without one the session falls back
   * to the localhost matcher in development and trusts nothing in production.
   */
  readonly allowedOrigins?: readonly string[];
  /** `'parent-or-opener'` (default) refuses every window but the framing or opening one. */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** Trust `document.referrer` as an origin source. Default `false`. */
  readonly enableReferrerDetection?: boolean;
  /** Match `localhost` origins in development. Default `true`. */
  readonly enableLocalhostMatching?: boolean;
  /**
   * The document this session previews. An update for another document is ignored, and so is
   * one that does not say which document it is for: Payload 2 sends no collection or global
   * slug, and a create screen has no id yet. Without it the session merges every update.
   */
  readonly document?: PreviewDocument;
  /** Injected for tests. */
  readonly fetchFn?: typeof fetch;
  /** Window to listen on. Default the global one. */
  readonly target?: Window;
}

type Listener = () => void;

/** What the merger logged for the attempt that failed, turned into one sentence. */
function reasonFrom(line: readonly unknown[]): string {
  const [label, detail] = line;
  if (label === 'merge HTTP') return `the server answered ${String(detail)}`;
  if (label === 'merge timeout') return `the server did not answer within ${String(detail)} ms`;
  if (label === 'merge invalid') return 'the server answered with something other than a document';
  if (label === 'merge exception') {
    return detail instanceof Error ? detail.message : 'the request failed';
  }
  return 'the update could not be merged';
}

/**
 * One preview document, with no framework around it: `subscribe` and `getSnapshot`
 * fit a `useSyncExternalStore` or a Svelte store.
 * @beta
 */
export class DocumentSession<T> {
  readonly #merger: DataMerger;
  readonly #bus: MessageBus;
  readonly #detector: OriginDetector;
  readonly #target: Window | undefined;
  readonly #listeners = new Set<Listener>();
  readonly #initial: DocumentSnapshot<T>;
  #snapshot: DocumentSnapshot<T>;
  /** Newest handled message; an older merge that settles later is ignored. */
  #revision = 0;
  #lastLog: readonly unknown[] = [];
  #attached = false;
  #schema: readonly PayloadFieldSchema[] | undefined;
  #locale: string | undefined;
  readonly #document: PreviewDocument | undefined;
  #warnedUnproven = false;
  #warnedPayload2 = false;

  constructor(initialData: T, options: DocumentSessionOptions) {
    this.#detector = new OriginDetector({
      ...(options.allowedOrigins !== undefined
        ? { additionalOrigins: options.allowedOrigins }
        : {}),
      enableReferrerDetection: options.enableReferrerDetection ?? false,
      ...(options.enableLocalhostMatching !== undefined
        ? { enableLocalhostMatching: options.enableLocalhostMatching }
        : {}),
    });
    this.#merger = new DataMerger({
      serverURL: options.serverURL,
      ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
      ...(options.depth !== undefined ? { depth: options.depth } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
      log: (...args: unknown[]) => {
        this.#lastLog = args;
      },
    });
    this.#bus = new MessageBus((origin) => this.#detector.matches(origin), {
      onUpdate: (message) => {
        void this.#handle(message);
      },
      onDocumentEvent: () => {
        // A save is the admin's business; the document itself arrives as an
        // update like any other.
      },
      sourcePolicy: options.eventSourcePolicy ?? 'parent-or-opener',
    });
    this.#target = options.target;
    this.#document = options.document;
    this.#initial = {
      data: initialData,
      isLoading: true,
      status: 'idle',
      error: undefined,
      revision: 0,
    };
    this.#snapshot = this.#initial;
  }

  /**
   * Attach on the first subscriber and detach with the last, so a component
   * that mounts twice (React's strict mode) listens once and a page that
   * unmounts the hook stops listening at all.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#attached) this.#attach();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#detach();
    };
  };

  getSnapshot = (): DocumentSnapshot<T> => this.#snapshot;

  /** Server rendering has no window and no messages: the initial snapshot a client render starts from. */
  getServerSnapshot = (): DocumentSnapshot<T> => this.#initial;

  #attach(): void {
    if (typeof window === 'undefined' && this.#target === undefined) return;
    this.#attached = true;
    this.#bus.attach(this.#target ?? window);
    MessageBus.sendReady(this.#readyTargets(), this.#detector.enumerate());
  }

  #detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    this.#revision += 1;
    this.#bus.detach();
    this.#merger.destroy();
  }

  #readyTargets(): Window[] {
    const host = this.#target ?? (typeof window === 'undefined' ? undefined : window);
    if (host === undefined) return [];
    const targets: Window[] = [];
    if (host.parent !== host) targets.push(host.parent);
    const opener: unknown = host.opener;
    if (opener !== null && opener !== undefined && opener !== host) targets.push(opener as Window);
    return targets;
  }

  #current(revision: number): boolean {
    return this.#attached && revision === this.#revision;
  }

  /** Whether the update is for the document this session previews; any update is without one. */
  #accepts(message: PayloadLivePreviewMessage, data: Record<string, unknown>): boolean {
    const target = this.#document;
    if (target === undefined) return true;
    const { locale, globalSlug, collectionSlug } = message;
    if (target.locale !== undefined && locale !== undefined && locale !== target.locale) {
      return false;
    }
    if ('global' in target) {
      if (globalSlug !== undefined) return globalSlug === target.global;
      if (collectionSlug !== undefined) return false;
    } else {
      if (globalSlug !== undefined) return false;
      if (collectionSlug !== undefined && collectionSlug !== target.collection) return false;
      const id = collectionSlug === undefined ? undefined : readDocumentId(data);
      if (id !== undefined) return id === String(target.id);
    }
    this.#warnUnproven(target);
    return false;
  }

  #warnUnproven(target: PreviewDocument): void {
    if (this.#warnedUnproven || !isDevMode()) return;
    this.#warnedUnproven = true;
    const named =
      'global' in target
        ? `global "${target.global}"`
        : `collection "${target.collection}", id "${String(target.id)}"`;
    console.warn(
      `[payload-live-preview] This hook previews ${named} and ignored an update that does not ` +
        'say which document it is for: Payload 2 sends no collection or global slug, and a ' +
        'create screen has no id yet.',
    );
  }

  async #handle(message: PayloadLivePreviewMessage): Promise<void> {
    const data = message.data;
    if (data === undefined) return;
    if (message.fieldSchemaJSON !== undefined && !this.#warnedPayload2 && isDevMode()) {
      this.#warnedPayload2 = true;
      console.warn(PAYLOAD_2_HINT);
    }
    // Before the revision moves: an update for another document must not abort this one's merge.
    if (!this.#accepts(message, data)) return;
    const revision = (this.#revision += 1);
    if (message.fieldSchemaJSON !== undefined) this.#schema = message.fieldSchemaJSON;
    const schema = this.#schema;
    if (message.locale !== undefined) this.#locale = message.locale;
    const locale = schema === undefined ? message.locale : this.#locale;
    this.#publish({ ...this.#snapshot, isLoading: true });
    if (!this.#current(revision)) return;
    this.#lastLog = [];
    const result = await this.#merger.merge({
      data,
      ...(schema === undefined ? {} : { schema }),
      ...(message.collectionSlug !== undefined ? { collectionSlug: message.collectionSlug } : {}),
      ...(message.globalSlug !== undefined ? { globalSlug: message.globalSlug } : {}),
      ...(locale !== undefined ? { locale } : {}),
    });
    // A newer message owns the state now, whatever this one turned out to be.
    if (!this.#current(revision)) return;
    if (result.status === 'superseded') return;
    if (result.status === 'unavailable') {
      this.#publish({
        ...this.#snapshot,
        isLoading: false,
        status: 'unavailable',
        error: new Error(`live preview: ${reasonFrom(this.#lastLog)}`),
      });
      return;
    }
    // The server decides the document's shape; `T` is what the caller says it is.
    this.#publish({
      data: result.doc as T,
      isLoading: false,
      status: 'live',
      error: undefined,
      revision,
    });
  }

  #publish(next: DocumentSnapshot<T>): void {
    const current = this.#snapshot;
    if (
      current.data === next.data &&
      current.isLoading === next.isLoading &&
      current.status === next.status &&
      current.error === next.error &&
      current.revision === next.revision
    ) {
      return;
    }
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }
}
