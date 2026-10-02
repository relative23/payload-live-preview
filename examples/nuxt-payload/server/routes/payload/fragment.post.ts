/**
 * The fragment endpoint as a Nitro route (docs/hybrid.md). The binding returns
 * a `Request` → `Response` function, so the H3 event is converted once here and
 * this package needs no `h3` dependency of its own.
 *
 * The page itself is authorized by intent in this fixture (`defaults: 'v1'`),
 * but the endpoint never is: it verifies the signed token in the framed URL,
 * because rendering a draft is not something intent may decide (ADR 0006).
 */
import { createFragmentEndpoint } from 'payload-live-preview/nuxt';
import Hero from '../../../components/Hero.vue';
import Notice from '../../../components/Notice.vue';
import { heroProps } from '../../../lib/hero';
import { PREVIEW_AUDIENCE, PREVIEW_TOKEN_SECRET } from '../../../lib/preview';

const endpoint = createFragmentEndpoint({
  registry: {
    hero: { component: Hero, props: ({ fields }) => heroProps(fields) },
    // A fragment is a standalone Vue app (ADR 0030): what the component would
    // read from Nuxt — the request's context, the runtime config — reaches it
    // as props, read here on the server.
    notice: {
      component: Notice,
      props: ({ fields, locals }) => ({
        text: typeof fields['notice'] === 'string' ? fields['notice'] : '',
        edition: (locals as { edition?: string } | undefined)?.edition ?? '',
        site: useRuntimeConfig().public.siteName,
      }),
    },
  },
  authorize: {
    type: 'signed-token',
    secret: PREVIEW_TOKEN_SECRET,
    audience: PREVIEW_AUDIENCE,
  },
});

export default defineEventHandler((event) => endpoint(toWebRequest(event), event));
