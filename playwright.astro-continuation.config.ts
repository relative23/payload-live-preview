/**
 * Run the host contract inside an isolated Astro Node production consumer.
 * Credential-bearing requests keep recording disabled across all browsers.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  metadata: { continuationFramework: 'astro' },
  outputDir: 'test-results/playwright-astro-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4287' },
});
