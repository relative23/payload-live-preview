/**
 * Run the shared host contract on a native adapter-node consumer of SvelteKit 3, built from
 * its own example and template. Inherit the credential-safe browser recording policy.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  metadata: { continuationFramework: 'sveltekit3' },
  outputDir: 'test-results/playwright-sveltekit3-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4292' },
});
