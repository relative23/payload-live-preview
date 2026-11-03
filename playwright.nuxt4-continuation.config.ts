/**
 * Run the shared host contract inside a Nitro production consumer of Nuxt 4, in Nuxt 4's
 * `app/` layout. Credential-bearing requests inherit the recording restrictions of Next.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  metadata: { continuationFramework: 'nuxt4' },
  outputDir: 'test-results/playwright-nuxt4-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4293' },
});
