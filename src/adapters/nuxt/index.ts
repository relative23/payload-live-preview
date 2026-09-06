/** Public entry for the nuxt adapter; the implementation lives in ./adapter so coverage measures it. */
export * from './adapter';
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
