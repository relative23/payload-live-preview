/**
 * Disabled-by-default Nitro transport fixture. The public endpoint receives
 * the H3 event for cancellation; the probe only observes the socket independently.
 */
import { createFragmentEndpoint } from 'payload-live-preview/nuxt';
import { createLifetimeProbe } from '../../../../shared/fragment-lifetime-probe';

const probe = createLifetimeProbe(createFragmentEndpoint);
export default defineEventHandler((event) =>
  probe(toWebRequest(event), event, event.node.req.socket),
);
