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
 * mergers, two revisions and two snapshots, and neither can hand the other a
 * document it never asked for.
 */

import { DataMerger } from '@core/data-merger';
import { MessageBus } from '@core/message-bus';
import { OriginDetector } from '@detection/origin';
import type { PayloadLivePreviewMessage } from '@/types/payload-protocol';

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
}

export interface DocumentSessionOptions {
  /** Payload server origin the update is re-fetched from. */
  readonly serverURL: string;
  /** REST route prefix. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth for the merge. Default `1`, as Payload's own hook. */
  readonly depth?: number;
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
  if (label === 'merge invalid') return 'the server answered with something other than a document';
  if (label === 'merge exception') {
    return detail instanceof Error ? detail.message : 'the request failed';
  }
  return 'the update could not be merged';
}

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
    this.#initial = { data: initialData, isLoading: true, status: 'idle', error: undefined };
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

  /** Server rendering has no window and no messages: the initial document, not loading. */
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

  async #handle(message: PayloadLivePreviewMessage): Promise<void> {
    const data = message.data;
    if (data === undefined) return;
    const revision = (this.#revision += 1);
    this.#publish({ ...this.#snapshot, isLoading: true });
    this.#lastLog = [];
    const result = await this.#merger.merge({
      data,
      ...(message.collectionSlug !== undefined ? { collectionSlug: message.collectionSlug } : {}),
      ...(message.globalSlug !== undefined ? { globalSlug: message.globalSlug } : {}),
      ...(message.locale !== undefined ? { locale: message.locale } : {}),
    });
    // A newer message owns the state now, whatever this one turned out to be.
    if (revision !== this.#revision) return;
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
    });
  }

  #publish(next: DocumentSnapshot<T>): void {
    const current = this.#snapshot;
    if (
      current.data === next.data &&
      current.isLoading === next.isLoading &&
      current.status === next.status &&
      current.error === next.error
    ) {
      return;
    }
    this.#snapshot = next;
    for (const listener of [...this.#listeners]) listener();
  }
}
