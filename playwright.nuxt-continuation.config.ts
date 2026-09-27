/**
 * Run the host contract inside an independent Nitro production consumer.
 * Credential-bearing requests inherit the recording restrictions of Next.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  metadata: { continuationFramework: 'nuxt' },
  outputDir: 'test-results/playwright-nuxt-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4286' },
});
