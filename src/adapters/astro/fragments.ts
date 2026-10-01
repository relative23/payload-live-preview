/**
 * The Astro binding of the fragment endpoint: Astro's container API as the
 * renderer, and the endpoint shaped as an Astro API route. Everything the
 * endpoint decides — authorization, limits, the protocol, the registry lookup —
 * is in `@adapters/shared/fragment-endpoint`.
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

/** An Astro component as `import Hero from './Hero.astro'` yields it. */
export type AstroComponentLike = object;

export type FragmentRegistryEntry<Props extends object = object> = SharedRegistryEntry<
  AstroComponentLike,
  Props
>;
/** @internal */
export type FragmentRegistry = SharedRegistry<AstroComponentLike>;
/** @internal */
export type FragmentRenderer = SharedRenderer<AstroComponentLike>;
export type FragmentEndpointOptions = SharedOptions<AstroComponentLike>;

const RENDERER_NAME = 'astro-container';

interface ContainerLike {
  renderToString: (
    component: AstroComponentLike,
    options: {
      locals: {
        __payloadLivePreviewFragment: {
          component: AstroComponentLike;
          props: Record<string, unknown>;
        };
      };
    },
  ) => Promise<string>;
}

/** One container per process; see `lazyPeer` for what a failed start does. */
const loadContainer = lazyPeer(async (): Promise<ContainerLike> => {
  // Through a variable so the bundler leaves it as a runtime import: `astro` is
  // an optional peer, and a project without it must still be able to install
  // this package.
  const specifier = 'astro/container';
  try {
    const astro = (await import(/* @vite-ignore */ specifier)) as {
      experimental_AstroContainer: { create: () => Promise<unknown> };
    };
    return (await astro.experimental_AstroContainer.create()) as ContainerLike;
  } catch (cause) {
    throw missingPeerError(['astro'], cause);
  }
});

// Share the first template load just like container creation, never request data.
// The literal import is for the consumer's compiler; custom renderers never load it.
const loadBridge = lazyPeer(async () => (await import('./FragmentBridge.astro')).default);

const renderWithContainer: FragmentRenderer = async (component, props) => {
  const container = await loadContainer();
  const FragmentBridge = await loadBridge();
  // Astro 4.9 has locals but no Container props option.
  return container.renderToString(FragmentBridge, {
    locals: { __payloadLivePreviewFragment: { component, props } },
  });
};

/** Build the endpoint; export it as the `POST` of a non-prerendered Astro API route. */
export function createFragmentEndpoint(
  options: FragmentEndpointOptions,
): (context: { readonly request: Request; readonly locals?: unknown }) => Promise<Response> {
  const handler = createFragmentEndpointHandler(options, {
    render: renderWithContainer,
    rendererName: RENDERER_NAME,
  });
  return ({ request, locals }) => handler(request, locals);
}
