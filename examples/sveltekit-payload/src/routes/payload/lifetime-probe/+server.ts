/**
 * Disabled-by-default adapter-node transport fixture. Pass the actual route
 * event to the public binding; observe the socket without cancelling work here.
 */
import { createFragmentEndpoint } from 'payload-live-preview/sveltekit';
import { createLifetimeProbe } from '../../../../../shared/fragment-lifetime-probe';
import type { RequestHandler } from './$types';

const probe = createLifetimeProbe((options) => {
  const endpoint = createFragmentEndpoint(options);
  return (request: Request, event?: Parameters<typeof endpoint>[0]) =>
    endpoint(event ?? { request });
});
export const GET: RequestHandler = (event) =>
  probe(
    event.request,
    event,
    (event.platform as { req?: { socket?: unknown } } | undefined)?.req?.socket,
  );
export const POST: RequestHandler = GET;
