/**
 * The React hook: Payload's `useLivePreview` shape, with this package's merge
 * underneath — one request at a time, the newer one winning, an HTTP error
 * refused instead of becoming the document, and a cache that belongs to this
 * hook alone (ADR 0002).
 *
 * It re-renders your component tree, so conditional sections and derived values
 * are as correct as a server render. What it cannot do is keep the visitor's
 * state: React re-renders the subtree, and focus, scroll and typed values go
 * with it. The DOM runtime is the other side of that trade (docs/react.md).
 *
 * `react` is an optional peer, and this entry is the only one that imports it.
 *
 * The published file starts with `'use client'`. It is not written here because
 * esbuild drops a module directive when it bundles; the build adds it back as a
 * banner (`DIRECTIVE_ENTRIES` in scripts/package-entries.ts).
 */

import { useRef, useSyncExternalStore } from 'react';
import {
  DocumentSession,
  type DocumentSessionOptions,
  type DocumentSnapshot,
  type DocumentStatus,
} from '@adapters/shared/document-session';

export type { DocumentSessionOptions, DocumentSnapshot, DocumentStatus };

export { LivePreviewRouteRefresh, type LivePreviewRouteRefreshProps } from './route-refresh';
export { registerRouteRefresh, type RouteRefresh } from '@core/route-refresh';

export interface UseLivePreviewDocumentOptions<T> extends DocumentSessionOptions {
  /** The document the page was rendered from; returned until an update merges. */
  readonly initialData: T;
}

/**
 * Subscribe to the admin's updates and return the merged document.
 *
 * ```tsx
 * const { data, status } = useLivePreviewDocument<Page>({
 *   serverURL: process.env.NEXT_PUBLIC_PAYLOAD_URL!,
 *   allowedOrigins: [process.env.NEXT_PUBLIC_PAYLOAD_URL!],
 *   initialData: page,
 *   depth: 1,
 * });
 * ```
 *
 * Returns `{ data, isLoading }` as Payload's hook does, plus `status` and
 * `error`: a merge that fails keeps the last good document instead of leaving
 * the page on a stale one with no way to tell.
 */
export function useLivePreviewDocument<T>(
  options: UseLivePreviewDocumentOptions<T>,
): DocumentSnapshot<T> {
  const session = useSessionFor(options);
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
}

/**
 * One session per hook instance, rebuilt only when a connection option changes.
 * `initialData` is deliberately not one of them: a re-render with a fresh object
 * identity must not throw away a document that already merged.
 */
function useSessionFor<T>(options: UseLivePreviewDocumentOptions<T>): DocumentSession<T> {
  const {
    initialData,
    serverURL,
    apiRoute,
    depth,
    allowedOrigins,
    eventSourcePolicy,
    enableReferrerDetection,
    enableLocalhostMatching,
    fetchFn,
    target,
  } = options;
  const key = [
    serverURL,
    apiRoute ?? '',
    String(depth ?? ''),
    (allowedOrigins ?? []).join(' '),
    eventSourcePolicy ?? '',
    String(enableReferrerDetection ?? ''),
    String(enableLocalhostMatching ?? ''),
    // A separator no origin, route prefix or policy name can contain.
  ].join(' | ');
  const held = useRef<{ key: string; session: DocumentSession<T> } | null>(null);
  if (held.current?.key !== key) {
    held.current = {
      key,
      session: new DocumentSession<T>(initialData, {
        serverURL,
        ...(apiRoute !== undefined ? { apiRoute } : {}),
        ...(depth !== undefined ? { depth } : {}),
        ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
        ...(eventSourcePolicy !== undefined ? { eventSourcePolicy } : {}),
        ...(enableReferrerDetection !== undefined ? { enableReferrerDetection } : {}),
        ...(enableLocalhostMatching !== undefined ? { enableLocalhostMatching } : {}),
        ...(fetchFn !== undefined ? { fetchFn } : {}),
        ...(target !== undefined ? { target } : {}),
      }),
    };
  }
  return held.current.session;
}
