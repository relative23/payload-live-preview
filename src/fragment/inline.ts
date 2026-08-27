/**
 * The inline prelude for the fragment client: built by scripts/build-runtime.ts
 * into an IIFE that leaves `__LIVE_PREVIEW_FRAGMENT__` with the strategy
 * factory, and emitted by the generator ahead of the runtime only for pages
 * configured with `fragments`. The runtime looks the global up by `typeof`,
 * so a page without the prelude carries nothing of the client.
 *
 * @module @fragment/inline
 */
export { createFragmentStrategy } from './index';
export { createRouteStrategy } from './route';
