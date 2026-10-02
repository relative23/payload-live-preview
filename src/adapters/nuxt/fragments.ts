/**
 * The Nuxt binding of the fragment endpoint: Vue's server renderer, and the
 * endpoint as a plain `Request` → `Response` function a Nitro route handler
 * wraps. Everything the endpoint decides is in
 * `@adapters/shared/fragment-endpoint`.
 *
 * `vue` is an optional peer loaded at the first render. The handler takes a
 * `Request` rather than an H3 event so this package needs no `h3` dependency to
 * describe its own signature; the one-line wrapper is in docs/nuxt.md.
 */
import { lazyPeer, missingPeerError } from '@adapters/shared/optional-peer';
import { withNodeFragmentRequest } from '@adapters/shared/fragment-node-request';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions as SharedOptions,
  type FragmentRegistry as SharedRegistry,
  type FragmentRegistryEntry as SharedRegistryEntry,
  type FragmentRenderer as SharedRenderer,
} from '@adapters/shared/fragment-endpoint';

export type { FragmentRenderInput } from '@adapters/shared/fragment-endpoint';

/**
 * A Vue component as `import Hero from './Hero.vue'` yields it — an options
 * object, or a functional component, which is also an object structurally.
 * Duck-typed rather than imported from `vue`, so the optional peer stays
 * optional at typecheck time as well.
 */
export type VueComponentLike = object;

export type FragmentRegistryEntry<Props extends object = object> = SharedRegistryEntry<
  VueComponentLike,
  Props
>;
/** @internal */
export type FragmentRegistry = SharedRegistry<VueComponentLike>;
/** @internal */
export type FragmentRenderer = SharedRenderer<VueComponentLike>;
export type FragmentEndpointOptions = SharedOptions<VueComponentLike>;

const RENDERER_NAME = 'vue-server-renderer';

/** The one part of a Vue app this binding sets: where Vue reports an error it does not throw. */
interface VueAppLike {
  readonly config: { errorHandler?: (error: unknown) => void };
}

interface VueRuntime {
  readonly createSSRApp: (
    component: VueComponentLike,
    props: Record<string, unknown>,
  ) => VueAppLike;
  readonly renderToString: (app: VueAppLike) => Promise<string>;
}

const loadVue = lazyPeer(async (): Promise<VueRuntime> => {
  // Through variables so the bundler leaves them as runtime imports.
  const vueSpecifier = 'vue';
  const rendererSpecifier = 'vue/server-renderer';
  try {
    const [vue, renderer] = await Promise.all([
      import(/* @vite-ignore */ vueSpecifier) as Promise<{
        createSSRApp: VueRuntime['createSSRApp'];
      }>,
      import(/* @vite-ignore */ rendererSpecifier) as Promise<{
        renderToString: VueRuntime['renderToString'];
      }>,
    ]);
    return { createSSRApp: vue.createSSRApp, renderToString: renderer.renderToString };
  } catch (cause) {
    throw missingPeerError(['vue'], cause);
  }
});

/**
 * One app per render, not one per process: an SSR app carries the props it was
 * created with, and every revision brings new ones.
 *
 * Vue's production build does not throw a component's setup or render error
 * out of `renderToString`; it hands it to `config.errorHandler`, or logs it,
 * and renders the component as an empty comment. Only the development build
 * rethrows. So the first error is kept and thrown after the render: a fragment
 * that resolved anyway would empty its boundary instead of failing (PHD-17).
 */
const renderWithVue: FragmentRenderer = async (component, props) => {
  const { createSSRApp, renderToString } = await loadVue();
  const app = createSSRApp(component, props);
  const failures: unknown[] = [];
  app.config.errorHandler = (error) => {
    failures.push(error);
  };
  const html = await renderToString(app);
  if (failures.length > 0) throw failures[0];
  return html;
};

/**
 * Build the endpoint. Nitro hands a route handler an H3 event, so wrap it:
 *
 * ```ts
 * // server/routes/payload/fragment.post.ts
 * const endpoint = createFragmentEndpoint({ registry, authorize });
 * export default defineEventHandler((event) => endpoint(toWebRequest(event), event));
 * ```
 */
export function createFragmentEndpoint(
  options: FragmentEndpointOptions,
): (
  request: Request,
  event?: { readonly node?: { readonly req?: unknown }; readonly context?: unknown },
) => Promise<Response> {
  const handler = createFragmentEndpointHandler(options, {
    render: renderWithVue,
    rendererName: RENDERER_NAME,
  });
  return (request, event) =>
    withNodeFragmentRequest(request, event?.node?.req, (fragmentRequest) =>
      handler(fragmentRequest, event?.context),
    );
}
