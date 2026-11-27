/** Public entry for the nuxt adapter; the implementation lives in ./adapter so coverage measures it. */
export {
  buildLivePreviewCsp,
  defineLivePreviewServerHandler,
  livePreviewNitroPlugin,
  renderLivePreviewScript,
  type LivePreviewLocals,
  type LivePreviewNuxtOptions,
  type NitroHandler,
  type PreviewAdapterOptions,
} from './adapter';
export {
  createFragmentEndpoint,
  type FragmentEndpointOptions,
  type FragmentRegistry,
  type FragmentRegistryEntry,
  type FragmentRenderer,
  type FragmentRenderInput,
  type VueComponentLike,
} from './fragments';
export { createRuntimeAssetRoute } from './asset-route';
