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
  hasPreviewIntent,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- kept through 1.x (ADR 0007, entry 1)
  isPreviewRequest,
  type PreviewRequestLike,
  type PreviewRequestOptions,
} from '@adapters/shared/preview-request';
