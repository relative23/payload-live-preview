/**
 * Astro adapter — public barrel.
 *
 * @module @adapters/astro
 */

export { livePreview, type AstroIntegrationLike } from './integration';
export {
  createLivePreviewMiddleware,
  NONCE_LOCALS_KEY,
  type LivePreviewMiddleware,
} from './middleware';
export { renderLivePreviewScript, type RenderScriptOptions } from './component';
export type { LivePreviewAstroOptions } from './types';
export {
  isPreviewRequest,
  type PreviewRequestLike,
  type PreviewRequestOptions,
} from '@adapters/shared/preview-request';
