/**
 * Standalone Vue uses an explicit Node service after its client and SSR builds.
 * The shared runner preserves loopback TLS, cancellation and owned cleanup.
 */
import { runNodeProductionFixture } from './node-production-fixture.mjs';

runNodeProductionFixture('vue');
