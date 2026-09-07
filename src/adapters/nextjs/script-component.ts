/**
 * `<LivePreviewScript />` — the delivery that charges an anonymous visitor
 * nothing.
 *
 * A root layout renders for every request, and the two helpers that served it
 * until now build the script whoever is asking: `livePreviewScriptProps()` and
 * `renderLivePreviewScript()` are synchronous, so they cannot wait for a
 * verdict and do not try. That is why the demo answered a `curl` without a
 * cookie with 195 342 of 254 707 bytes of preview runtime — once in the
 * document, once more escaped into the RSC flight payload underneath it.
 *
 * An async server component can wait. This one runs the same policy every
 * adapter runs — intent, then `authorizePreview` — and returns `null` unless
 * the answer is yes. Not a few hundred bytes of bootstrap for the public:
 * nothing, the same as the Astro middleware, the SvelteKit handle and the Nuxt
 * Nitro plugin already deliver.
 *
 * **`next` is not imported here and must not become a dependency.** The
 * component takes the request as a prop, the way `<LivePreviewRouteRefresh />`
 * takes the router's refresh, and the caller builds it from what the framework
 * hands a server component:
 *
 * ```tsx
 * // app/layout.tsx — the App Router
 * import { headers } from 'next/headers';
 * import { LivePreviewScript } from 'payload-live-preview/nextjs';
 *
 * export default async function RootLayout({ children }: { children: ReactNode }) {
 *   return (
 *     <html lang="en">
 *       <head>
 *         <LivePreviewScript
 *           request={new Request(SITE_URL, { headers: await headers() })}
 *           inject="always"
 *           allowedOrigins={[ADMIN_URL]}
 *           authorizePreview={authorize}
 *         />
 *       </head>
 *       <body>{children}</body>
 *     </html>
 *   );
 * }
 * ```
 *
 * A `Request` rather than a shape of our own: it is what `authorizePreview`
 * and `shouldInject` already receive from the middleware, so one options object
 * serves both entry points and neither hook has to be written twice.
 *
 * The URL is the caller's to supply, and the recipe above says why `headers()`
 * alone is not enough: Next gives a server component the request headers and
 * cookies but not its URL, so a layout cannot see `?preview=true` and the
 * `query` signal — the 2.0 default — cannot fire there. `inject: 'always'`
 * then makes `authorizePreview` the single gate, which is the stricter reading
 * anyway and exactly what LP-8 needs. A page, which does get `searchParams`,
 * can pass the real URL and keep intent as the cheap pre-filter it is.
 * docs/nextjs.md carries both recipes.
 */

import { createPreviewPolicy } from '@adapters/shared/policy';
import { bindDecisionHooks } from '@adapters/shared/response';
import { lazyPeer } from '@adapters/shared/optional-peer';
import { livePreviewScriptProps, type LivePreviewNextOptions } from './adapter';
import type { LivePreviewScriptProps } from './adapter';

/** What the component takes: every adapter option, plus the request it decides for. */
export interface LivePreviewScriptComponentProps extends LivePreviewNextOptions {
  /**
   * The request this render answers: in the App Router, a `Request` built from
   * the URL and `await headers()`. A promise is accepted so the caller need not
   * resolve `headers()` first.
   */
  readonly request: Request | Promise<Request>;
  /** CSP nonce for the element, when the application manages one. */
  readonly nonce?: string;
}

/**
 * The `<script>` this resolves to, described structurally rather than as
 * `ReactElement`: the entry must not carry React's types any more than its
 * code, and a JSX consumer accepts this shape as a node all the same.
 */
export interface LivePreviewScriptElement {
  readonly type: 'script';
  readonly props: LivePreviewScriptProps;
  readonly key: null;
}

type CreateElement = (type: 'script', props: LivePreviewScriptProps) => LivePreviewScriptElement;

/**
 * `react` is an optional peer of this package and a hard dependency of any app
 * that can render this component, so it is loaded at the first render that
 * produces an element — never at import, and never on a public request, which
 * returns before reaching this.
 */
const loadCreateElement = lazyPeer(async (): Promise<CreateElement> => {
  // Through a variable so the bundler leaves it as a runtime import.
  const specifier = 'react';
  const react = (await import(/* @vite-ignore */ specifier)) as {
    createElement: CreateElement;
  };
  return react.createElement;
});

/**
 * Renders the runtime for an authorized preview and nothing at all for
 * everyone else. Mount it in the layout or page that owns `<head>`.
 */
export async function LivePreviewScript(
  props: LivePreviewScriptComponentProps,
): Promise<LivePreviewScriptElement | null> {
  const { request, nonce, ...options } = props;
  const policy = createPreviewPolicy(options);
  const resolved = await request;
  const decision = await policy.decide(resolved, bindDecisionHooks(policy, options, resolved));
  if (!decision.inject) return null;
  const createElement = await loadCreateElement();
  return createElement(
    'script',
    livePreviewScriptProps(nonce === undefined ? options : { ...options, nonce }),
  );
}
