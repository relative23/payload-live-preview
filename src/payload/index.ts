/**
 * `payload-live-preview/payload` — helpers for `payload.config.ts`. It never
 * imports `payload`, only produces the callback `admin.livePreview.url` expects.
 */

export {
  buildLivePreviewUrl,
  type BuildLivePreviewUrlNullableOptions,
  type BuildLivePreviewUrlOptions,
  type LivePreviewUrlArgs,
  type NullablePathResolver,
  type PathResolver,
  type PathResolverContext,
} from './live-preview-url';
