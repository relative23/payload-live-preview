/** Real credentials stay in memory; traces must never record login bodies or cookies. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './tests/e2e/continuation',
  testMatch: 'next-host.spec.ts',
  outputDir: 'test-results/playwright-next-continuation',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    ...base.use,
    baseURL: 'https://localhost:4284',
    ignoreHTTPSErrors: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [],
  timeout: 45_000,
});
