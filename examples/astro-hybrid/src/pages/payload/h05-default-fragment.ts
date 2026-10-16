/**
 * H05's default endpoint reaches the package's real Astro container binding.
 * Its response records which ambient values Astro supplied beyond the props.
 */
import { createFragmentEndpoint } from 'payload-live-preview/astro';
import H05AdditionalRendererProbe from '../../components/H05AdditionalRendererProbe.astro';
import H05ContextProbe from '../../components/H05ContextProbe.astro';
import { foreignProps, h05Strategy, probeProps } from '../../h05-context';

export const prerender = false;

export const POST = createFragmentEndpoint({
  registry: {
    foreign: { component: H05AdditionalRendererProbe, props: foreignProps },
    probe: { component: H05ContextProbe, props: probeProps },
  },
  authorize: h05Strategy,
});
