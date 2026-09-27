/**
 * Native SvelteKit production lifecycle: an adapter-node build and server
 * behind a local TLS front door. The ordinary suite retains its Vite
 * development coverage; this gate proves the strict production path.
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

const origin = process.env['PLP_SVELTE_ORIGIN'] ?? 'https://localhost:4275';
const internalPort = process.env['PLP_SVELTE_INTERNAL_PORT'] ?? '42750';
process.env['PLP_SVELTE_ORIGIN'] = origin;
process.env['PLP_SVELTE_INTERNAL_PORT'] = internalPort;

const config: PlaywrightTestConfig = {
  ...base,
  outputDir: 'test-results/playwright-sveltekit-production',
  testMatch: [
    'sveltekit-live-preview.spec.ts',
    'sveltekit-asset-delivery.spec.ts',
    'sveltekit-fragment.spec.ts',
  ],
  use: {
    ...base.use,
    baseURL: origin,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    name: 'sveltekit-production',
    command: 'node scripts/sveltekit-production-fixture.mjs',
    env: { ...process.env, PLP_SVELTE_ORIGIN: origin, PLP_SVELTE_INTERNAL_PORT: internalPort },
    url: `${origin}/admin.html`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
};

export default defineConfig(config);
