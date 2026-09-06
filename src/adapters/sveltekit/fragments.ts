/**
 * The SvelteKit binding of the fragment endpoint: Svelte's server renderer, and
 * the endpoint shaped as a `+server.ts` route handler. Everything the endpoint
 * decides is in `@adapters/shared/fragment-endpoint`.
 *
 * `svelte` is an optional peer loaded at the first render, so a project that
 * registers no fragment never needs it here.
 */
import { lazyPeer, missingPeerError } from '@adapters/shared/optional-peer';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions as SharedOptions,
  type FragmentRegistry as SharedRegistry,
  type FragmentRegistryEntry as SharedRegistryEntry,
  type FragmentRenderer as SharedRenderer,
} from '@adapters/shared/fragment-endpoint';

export type { FragmentRenderInput } from '@adapters/shared/fragment-endpoint';

/**
 * A Svelte component as `import Hero from './Hero.svelte'` yields it. Duck-typed
 * rather than imported from `svelte`: a type-only import would make the
 * optional peer required at typecheck time for every consumer of this entry.
 */
export type SvelteComponentLike = object;

export type FragmentRegistryEntry<Props extends object = object> = SharedRegistryEntry<
  SvelteComponentLike,
  Props
>;
export type FragmentRegistry = SharedRegistry<SvelteComponentLike>;
export type FragmentRenderer = SharedRenderer<SvelteComponentLike>;
export type FragmentEndpointOptions = SharedOptions<SvelteComponentLike>;

const RENDERER_NAME = 'svelte-server';

interface SvelteServer {
  readonly render: (
    component: SvelteComponentLike,
    options: { props: Record<string, unknown> },
  ) => { body: string };
}

/**
 * Written as a real specifier, unlike the other bindings' variable ones, and it
 * has to stay one.
 *
 * Svelte's server renderer keeps the current component context in a module
 * variable, and a component compiled by Vite reaches that variable through
 * Vite's own module graph. A specifier Vite cannot see — a variable, or one
 * marked `@vite-ignore` — is resolved by the runtime instead and yields a
 * second instance of the same file, with its own empty context: every render
 * then fails on a null context. Named plainly, the import goes through the
 * same graph as the components, and the two agree.
 *
 * `svelte` stays an optional peer: the import happens at the first render, and
 * the build lists it as external (tsup.config.ts) rather than resolving it.
 */
const loadSvelte = lazyPeer(async (): Promise<SvelteServer> => {
  try {
    // This repository does not install `svelte`, so the module has no types
    // here; `SvelteServer` above is the slice of it this binding uses. The
    // suppression is expected to fail loudly if the package is ever added.
    // @ts-expect-error -- optional peer, resolved in the consumer's project
    return (await import('svelte/server')) as SvelteServer;
  } catch (cause) {
    throw missingPeerError(['svelte'], cause);
  }
});

/**
 * Only `body` is delivered. `render()` also returns `head` — what the component
 * put in `<svelte:head>` — and a boundary is a region of the body, not of the
 * document: writing that into the boundary would show the markup as text. The
 * head belongs to the route strategy (docs/hybrid.md).
 */
const renderWithSvelte: FragmentRenderer = async (component, props) => {
  const svelte = await loadSvelte();
  return svelte.render(component, { props }).body;
};

/** Build the endpoint; export it as the `POST` of a `+server.ts` route. */
export function createFragmentEndpoint(
  options: FragmentEndpointOptions,
): (event: { readonly request: Request }) => Promise<Response> {
  const handler = createFragmentEndpointHandler(options, {
    render: renderWithSvelte,
    rendererName: RENDERER_NAME,
  });
  return ({ request }) => handler(request);
}
