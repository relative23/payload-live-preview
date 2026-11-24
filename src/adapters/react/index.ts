/**
 * `payload-live-preview/react` — the React hook, the route-refresh component
 * and the session types the hook returns.
 *
 * The published file starts with `'use client'`. It is not written here because
 * esbuild drops a module directive when it bundles, and a banner with it; the
 * build writes it back through terser's `preamble` (`DIRECTIVE_ENTRIES` in
 * scripts/package-entries.ts, applied in scripts/build-dist.ts).
 */

export {
  useLivePreviewDocument,
  type UseLivePreviewDocumentOptions,
} from './use-live-preview-document';
export type {
  DocumentSessionOptions,
  DocumentSnapshot,
  DocumentStatus,
} from '@adapters/shared/document-session';
export { LivePreviewRouteRefresh, type LivePreviewRouteRefreshProps } from './route-refresh';
export { registerRouteRefresh, type RouteRefresh } from '@core/route-refresh';
