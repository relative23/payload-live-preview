/**
 * `payload-live-preview/vue` — the Vue composable and the session types it
 * returns. `vue` is an optional peer; `./use-live-preview-document` imports it.
 */

export {
  useLivePreviewDocument,
  type LivePreviewDocumentRefs,
  type UseLivePreviewDocumentOptions,
} from './use-live-preview-document';
export type {
  DocumentSessionOptions,
  DocumentSnapshot,
  DocumentStatus,
} from '@adapters/shared/document-session';
