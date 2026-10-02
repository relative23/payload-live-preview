/**
 * The fragment endpoint on a host that only speaks the Web API. The Next.js
 * binding takes a plain `Request` and loads no Node module until its default
 * renderer runs, which this probe never does, so the same bundle serves Deno,
 * Bun and Node. The lifetime probe is the one the framework fixtures use.
 */
import { createFragmentEndpoint } from 'payload-live-preview/nextjs';
import { createLifetimeProbe } from '../../../examples/shared/fragment-lifetime-probe';

const probe = createLifetimeProbe((options) => createFragmentEndpoint(options));

/** `/healthz` answers the runner's readiness poll; everything else is the probe. */
export default function handle(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === '/healthz') return Promise.resolve(new Response('ok'));
  return probe(request);
}
