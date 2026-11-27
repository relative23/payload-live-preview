/** Astro adapter — public barrel. */

export { livePreview, type AstroIntegrationLike } from './integration';
export { resolveIslandModule, type IslandModuleResolver } from './island-modules';
export {
  createLivePreviewMiddleware,
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
export {
  createFragmentEndpoint,
  type AstroComponentLike,
  type FragmentEndpointOptions,
  type FragmentRegistry,
  type FragmentRegistryEntry,
  type FragmentRenderInput,
  type FragmentRenderer,
} from './fragments';
