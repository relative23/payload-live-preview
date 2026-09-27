/**
 * Build and start Nitro rather than treating a development server as production.
 * The host consumer provides its isolated directory and explicit local-test opt-in.
 */
import { runNodeProductionFixture } from './node-production-fixture.mjs';

runNodeProductionFixture('nuxt');
