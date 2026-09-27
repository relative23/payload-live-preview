/**
 * H05's custom endpoint demonstrates the existing render override with an
 * allowlisted, verified page context. It never forwards browser headers or a
 * copied authorization object into Astro locals.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { createFragmentEndpoint, type FragmentRenderer } from 'payload-live-preview/astro';
import H05AdditionalRendererProbe from '../../components/H05AdditionalRendererProbe.astro';
import H05ContextProbe from '../../components/H05ContextProbe.astro';
import { h05Renderer } from '../../components/h05-foreign-component';
import { foreignProps, h05Strategy, probeProps, trustedPageContext } from '../../h05-context';

export const prerender = false;

const container = AstroContainer.create({ renderers: [h05Renderer] });
const renderWithTrustedContext: FragmentRenderer = async (component, props, input) => {
  const page = trustedPageContext(input);
  const instance = await container;
  return instance.renderToString(component as Parameters<typeof instance.renderToString>[0], {
    props,
    request: page.request,
    params: page.params,
    locals: {
      h05Preview: Object.freeze({ locale: page.locale, subject: page.subject }),
    },
  });
};

export const POST = createFragmentEndpoint({
  registry: {
    foreign: { component: H05AdditionalRendererProbe, props: foreignProps },
    probe: { component: H05ContextProbe, props: probeProps },
  },
  authorize: h05Strategy,
  render: renderWithTrustedContext,
});
