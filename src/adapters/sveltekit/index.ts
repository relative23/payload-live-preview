/** Public entry for the sveltekit adapter; the implementation lives in ./adapter so coverage measures it. */
export * from './adapter';
export {
  createFragmentEndpoint,
  type FragmentEndpointOptions,
  type FragmentRegistry,
  type FragmentRegistryEntry,
  type FragmentRenderer,
  type FragmentRenderInput,
  type SvelteComponentLike,
} from './fragments';
export { createRuntimeAssetRoute, type RuntimeAssetRoute } from './asset-route';
