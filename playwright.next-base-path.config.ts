/**
 * The Next.js production fixture built under a base path (`/docs`): the same
 * optimized build behind local TLS as playwright.next-production.config.ts,
 * so the Next specs run against an app that does not sit at the site root,
 * plus the cases only a base path or a rewrite can break (H16).
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

const origin = process.env['PLP_NEXT_ORIGIN'] ?? 'https://localhost:4292';
const internalPort = process.env['PLP_NEXT_INTERNAL_PORT'] ?? '42920';
const basePath = process.env['PLP_NEXT_BASE_PATH'] ?? '/docs';
process.env['PLP_NEXT_ORIGIN'] = origin;
process.env['PLP_NEXT_INTERNAL_PORT'] = internalPort;
process.env['PLP_NEXT_BASE_PATH'] = basePath;

const config: PlaywrightTestConfig = {
  ...base,
  outputDir: 'test-results/playwright-next-base-path',
  testMatch: [
    'nextjs-live-preview.spec.ts',
    'nextjs-asset-delivery.spec.ts',
    'nextjs-fragment.spec.ts',
    'nextjs-base-path.spec.ts',
  ],
  use: {
    ...base.use,
    baseURL: `${origin}${basePath}`,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    name: 'nextjs-base-path',
    command: 'node scripts/next-production-fixture.mjs',
    env: {
      ...process.env,
      PLP_NEXT_ORIGIN: origin,
      PLP_NEXT_INTERNAL_PORT: internalPort,
      NEXT_PUBLIC_BASE_PATH: basePath,
    },
    url: `${origin}${basePath}/admin.html`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
};

export default defineConfig(config);
