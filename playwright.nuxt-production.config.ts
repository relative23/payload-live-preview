/**
 * Native Nuxt production lifecycle: a Nitro node build and server
 * behind a local TLS front door. The ordinary suite retains its Vite
 * development coverage; this gate proves the strict production path.
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

const origin = process.env['PLP_NUXT_ORIGIN'] ?? 'https://localhost:4276';
const internalPort = process.env['PLP_NUXT_INTERNAL_PORT'] ?? '42760';
process.env['PLP_NUXT_ORIGIN'] = origin;
process.env['PLP_NUXT_INTERNAL_PORT'] = internalPort;

const config: PlaywrightTestConfig = {
  ...base,
  outputDir: 'test-results/playwright-nuxt-production',
  testMatch: ['nuxt-live-preview.spec.ts', 'nuxt-asset-delivery.spec.ts', 'nuxt-fragment.spec.ts'],
  use: {
    ...base.use,
    baseURL: origin,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    name: 'nuxt-production',
    command: 'node scripts/nuxt-production-fixture.mjs',
    env: { ...process.env, PLP_NUXT_ORIGIN: origin, PLP_NUXT_INTERNAL_PORT: internalPort },
    url: `${origin}/admin.html`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
};

export default defineConfig(config);
