/**
 * The Next.js binding of the fragment endpoint: React as the renderer, and the
 * endpoint shaped as an App Router route handler. Everything the endpoint
 * decides is in `@adapters/shared/fragment-endpoint`.
 *
 * `react` and `react-dom` are optional peers loaded at first render. A project
 * that never renders a fragment — most of them — installs neither, and a
 * project that does has both anyway.
 */
import { lazyPeer, missingPeerError } from '@adapters/shared/optional-peer';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions as SharedOptions,
  type FragmentRegistry as SharedRegistry,
  type FragmentRegistryEntry as SharedRegistryEntry,
  type FragmentRenderer as SharedRenderer,
  type FragmentRenderInput,
} from '@adapters/shared/fragment-endpoint';

export type { FragmentRenderInput } from '@adapters/shared/fragment-endpoint';

/**
 * A React function component.
 *
 * The parameter is `never` rather than the props object it will receive:
 * parameters are checked contravariantly, so this accepts a component with any
 * props while a `Record<string, unknown>` would accept almost none. What the
 * component and its props have to agree on is checked by `defineFragment()`,
 * which is why that helper exists.
 */
export type ReactComponentLike = (props: never) => unknown;

export type FragmentRegistryEntry<Props extends object = object> = SharedRegistryEntry<
  ReactComponentLike,
  Props
>;
/** @internal */
export type FragmentRegistry = SharedRegistry<ReactComponentLike>;
/** @internal */
export type FragmentRenderer = SharedRenderer<ReactComponentLike>;
export type FragmentEndpointOptions = SharedOptions<ReactComponentLike>;

const RENDERER_NAME = 'react-dom';

interface ReactRuntime {
  readonly createElement: (
    component: ReactComponentLike,
    props: Record<string, unknown>,
  ) => unknown;
  readonly renderToString: (element: unknown) => string;
}

const loadReact = lazyPeer(async (): Promise<ReactRuntime> => {
  // Through variables so the bundler leaves them as runtime imports; see the
  // module comment on why they are peers.
  const reactSpecifier = 'react';
  const serverSpecifier = 'react-dom/server';
  try {
    const [react, server] = await Promise.all([
      import(/* @vite-ignore */ reactSpecifier) as Promise<{
        createElement: ReactRuntime['createElement'];
      }>,
      import(/* @vite-ignore */ serverSpecifier) as Promise<{
        renderToString: ReactRuntime['renderToString'];
      }>,
    ]);
    return { createElement: react.createElement, renderToString: server.renderToString };
  } catch (cause) {
    throw missingPeerError(['react', 'react-dom'], cause);
  }
});

const renderWithReact: FragmentRenderer = async (component, props) => {
  const { createElement, renderToString } = await loadReact();
  return renderToString(createElement(component, props));
};

/**
 * Pairs a component with the props it takes, so the two cannot drift apart.
 * Without it a registry entry types its props as any record and a renamed prop
 * is found by the editor, in the preview, at the worst moment.
 *
 * ```ts
 * const registry = { hero: defineFragment(Hero, ({ fields }) => ({ title: String(fields.title ?? '') })) };
 * ```
 */
export function defineFragment<Props extends object>(
  component: (props: Props) => unknown,
  props: (input: FragmentRenderInput) => Props | Promise<Props>,
): FragmentRegistryEntry<Props> {
  return { component, props };
}

/** Build the endpoint; export it as the `POST` of an App Router route handler. */
export function createFragmentEndpoint(
  options: FragmentEndpointOptions,
): (request: Request) => Promise<Response> {
  return createFragmentEndpointHandler(options, {
    render: renderWithReact,
    rendererName: RENDERER_NAME,
  });
}
