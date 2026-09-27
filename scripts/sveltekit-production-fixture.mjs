/**
 * Keep the established adapter-node entry and environment contract stable.
 * The shared runner also serves the native Nuxt consumer through local TLS.
 */
import { runNodeProductionFixture } from './node-production-fixture.mjs';

runNodeProductionFixture('sveltekit');
