/**
 * Run the framework-free host through the shared loopback production TLS front door.
 * Its Node-only build records served assets without a framework compiler.
 */
import { runNodeProductionFixture } from './node-production-fixture.mjs';

runNodeProductionFixture('html');
