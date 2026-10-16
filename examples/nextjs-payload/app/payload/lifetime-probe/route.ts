/**
 * Disabled-by-default App Router transport fixture. Rendering is instrumented
 * separately from React so cancellation cannot be inferred from an HTTP code.
 */
import { createFragmentEndpoint } from 'payload-live-preview/nextjs';
import { createLifetimeProbe } from '../../../../shared/fragment-lifetime-probe';

const probe = createLifetimeProbe(createFragmentEndpoint);
export const GET = (request: Request) => probe(request);
export const POST = GET;
