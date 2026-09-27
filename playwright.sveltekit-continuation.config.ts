/**
 * Run the shared host contract on a separate native adapter-node consumer.
 * Inherit the credential-safe browser recording policy without a dev server.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  metadata: { continuationFramework: 'sveltekit' },
  outputDir: 'test-results/playwright-sveltekit-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4285' },
});
