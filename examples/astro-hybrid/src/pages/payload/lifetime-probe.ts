/**
 * Disabled-by-default HTTP lifecycle fixture. The factory comes from the built
 * public Astro entry; the shared probe supplies only diagnostic callbacks.
 */
import { createFragmentEndpoint } from 'payload-live-preview/astro';
import { createLifetimeProbe } from '../../../../shared/fragment-lifetime-probe';

export const prerender = false;
const probe = createLifetimeProbe((options) => {
  const endpoint = createFragmentEndpoint(options);
  return (request) => endpoint({ request });
});
export const ALL = ({ request }: { request: Request }): Promise<Response> => probe(request);
