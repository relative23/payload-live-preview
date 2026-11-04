/**
 * A pnpm workspace of Next.js sites on the retained archive, served one at a time on loopback
 * HTTP. No credential is involved; it keeps the continuation base's single worker, zero retries
 * and disabled recording, and gives each run the time a production build takes on a CI runner.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  testMatch: 'next-pnpm-workspace.spec.ts',
  outputDir: 'test-results/playwright-next-pnpm-workspace',
  use: { ...base.use, baseURL: 'http://localhost:4294' },
  timeout: 300_000,
});
