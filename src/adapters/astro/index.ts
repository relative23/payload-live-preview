/** Astro adapter — public barrel. */

export { livePreview, type AstroIntegrationLike } from './integration';
export {
  createLivePreviewMiddleware,
  NONCE_LOCALS_KEY,
  AUTHORIZATION_LOCALS_KEY,
  AUTHORIZATION_OUTCOME_LOCALS_KEY,
  type LivePreviewLocals,
  type LivePreviewMiddleware,
} from './middleware';
export { renderLivePreviewScript, type RenderScriptOptions } from './component';
export type { LivePreviewAstroOptions } from './types';
export type { PreviewAdapterOptions } from '@adapters/shared/options';
export {
  hasPreviewIntent,
  type PreviewRequestLike,
  type PreviewRequestOptions,
  type PreviewSignal,
} from '@adapters/shared/preview-request';
// 1.8.1 exported this name from `./astro` as well as from the root.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the alias exists to be re-exported
export { isPreviewRequest } from '@adapters/shared/preview-request-legacy';
export {
  createFragmentEndpoint,
  type AstroComponentLike,
  type FragmentEndpointOptions,
  type FragmentRegistry,
  type FragmentRegistryEntry,
  type FragmentRenderInput,
  type FragmentRenderer,
} from './fragments';
