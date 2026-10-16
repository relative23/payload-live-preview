/**
 * The existing TLS production consumer built by Next's own webpack bundler.
 * Its HTTP and browser contracts also run for the default Turbopack build.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-production.config';

const server = base.webServer;
if (server === undefined || Array.isArray(server)) {
  throw new Error('The Next production fixture requires exactly one server.');
}

export default defineConfig({
  ...base,
  outputDir: 'test-results/playwright-next-webpack-production',
  metadata: { ...base.metadata, nextBundler: 'webpack' },
  webServer: {
    ...server,
    name: 'nextjs-webpack-production',
    env: { ...server.env, PLP_NEXT_BUILD_BUNDLER: 'webpack' },
  },
});
