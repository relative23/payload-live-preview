/**
 * Native Next.js production lifecycle: optimized build, `next start`, and a
 * local TLS front door so strict policy sees the same HTTPS shape as a real
 * self-hosted deployment. The regular suite continues to exercise `next dev`.
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

const origin = process.env['PLP_NEXT_ORIGIN'] ?? 'https://localhost:4274';
const internalPort = process.env['PLP_NEXT_INTERNAL_PORT'] ?? '42740';
process.env['PLP_NEXT_ORIGIN'] = origin;
process.env['PLP_NEXT_INTERNAL_PORT'] = internalPort;

const config: PlaywrightTestConfig = {
  ...base,
  outputDir: 'test-results/playwright-next-production',
  testMatch: [
    'nextjs-live-preview.spec.ts',
    'nextjs-asset-delivery.spec.ts',
    'nextjs-fragment.spec.ts',
  ],
  use: {
    ...base.use,
    baseURL: origin,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    name: 'nextjs-production',
    command: 'node scripts/next-production-fixture.mjs',
    env: { ...process.env, PLP_NEXT_ORIGIN: origin, PLP_NEXT_INTERNAL_PORT: internalPort },
    url: `${origin}/admin.html`,
    ignoreHTTPSErrors: true,
    // Reusing a development server would make this gate report production
    // coverage without ever running `next build`/`next start`.
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
};

export default defineConfig(config);
