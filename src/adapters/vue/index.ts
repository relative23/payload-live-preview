/**
 * The Vue composable: Payload's `useLivePreview` shape, with this package's
 * merge underneath — one request at a time, the newer one winning, an HTTP
 * error refused instead of becoming the document, and a cache that belongs to
 * this call alone (ADR 0002).
 *
 * The same `DocumentSession` the React hook uses; only the reactivity is Vue's.
 * It touches no DOM: a composable re-renders your components, which is the
 * other side of the trade the runtime makes (docs/vue.md).
 *
 * `vue` is an optional peer. This entry and the Nuxt fragment renderer are the
 * only places that need it.
 */

import { computed, getCurrentScope, onScopeDispose, shallowRef, type ComputedRef } from 'vue';
import {
  DocumentSession,
  type DocumentSessionOptions,
  type DocumentSnapshot,
  type DocumentStatus,
} from '@adapters/shared/document-session';

export type { DocumentSessionOptions, DocumentSnapshot, DocumentStatus };

export interface UseLivePreviewDocumentOptions<T> extends DocumentSessionOptions {
  /** The document the page was rendered from; returned until an update merges. */
  readonly initialData: T;
}

/** One ref per field of the snapshot, so a template can bind them individually. */
export interface LivePreviewDocumentRefs<T> {
  /** The newest document that merged; never a partially applied one. */
  readonly data: ComputedRef<T>;
  /** No update has settled yet, or a merge is in flight. */
  readonly isLoading: ComputedRef<boolean>;
  readonly status: ComputedRef<DocumentStatus>;
  /** Why the last update did not merge; `undefined` unless `status` is `unavailable`. */
  readonly error: ComputedRef<Error | undefined>;
}

/**
 * Subscribe to the admin's updates and return the merged document as refs.
 *
 * ```vue
 * <script setup lang="ts">
 * const { data, status } = useLivePreviewDocument<Page>({
 *   serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
 *   allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_URL],
 *   initialData: page,
 *   depth: 1,
 * });
 * </script>
 * ```
 *
 * `data` and `isLoading` are Payload's two, with the same meaning; `status` and
 * `error` are added, so a merge that fails is visible rather than looking like a
 * document that did not change.
 *
 * Call it from `setup()` or inside an `effectScope()`: the subscription is
 * released when that scope is disposed, and there is nowhere else to release it.
 */
export function useLivePreviewDocument<T>(
  options: UseLivePreviewDocumentOptions<T>,
): LivePreviewDocumentRefs<T> {
  const scope = getCurrentScope();
  if (scope === undefined) {
    throw new Error(
      'payload-live-preview: useLivePreviewDocument() needs an effect scope — call it from ' +
        'setup() or inside effectScope(), so its window listener and any request in flight are ' +
        'released with the component.',
    );
  }
  const { initialData, ...connection } = options;
  const session = new DocumentSession<T>(initialData, connection);
  const snapshot = shallowRef<DocumentSnapshot<T>>(session.getSnapshot());
  onScopeDispose(
    session.subscribe(() => {
      // The session publishes a new object only when something changed, so a
      // shallow ref is enough to make every computed below re-evaluate.
      snapshot.value = session.getSnapshot();
    }),
  );
  return {
    data: computed(() => snapshot.value.data),
    isLoading: computed(() => snapshot.value.isLoading),
    status: computed(() => snapshot.value.status),
    error: computed(() => snapshot.value.error),
  };
}
