/** Public entry for the nextjs adapter; the implementation lives in ./adapter so coverage measures it. */
export * from './adapter';
export {
  createFragmentEndpoint,
  defineFragment,
  type FragmentEndpointOptions,
  type FragmentRegistry,
  type FragmentRegistryEntry,
  type FragmentRenderer,
  type FragmentRenderInput,
  type ReactComponentLike,
} from './fragments';
