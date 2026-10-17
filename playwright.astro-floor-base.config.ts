/**
 * The Astro 4.0.0 floor serves a static build over plain loopback HTTP to a mock parent.
 * No credential is involved, so this scope has no TLS front; it keeps the continuation
 * base's single worker, zero retries and disabled recording.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  testMatch: 'astro-floor-base.spec.ts',
  outputDir: 'test-results/playwright-astro-floor-base',
  use: { ...base.use, baseURL: 'http://localhost:4290' },
});
