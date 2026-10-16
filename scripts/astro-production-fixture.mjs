/**
 * Astro's standalone adapter uses the shared loopback TLS front door.
 * The native build and cleanup remain independent of any running demo.
 */
import { runNodeProductionFixture } from './node-production-fixture.mjs';
runNodeProductionFixture('astro');
