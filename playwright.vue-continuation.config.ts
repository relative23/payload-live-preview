/**
 * Standalone Vue builds separately from the Nuxt host and owns a real scope.
 * The shared TLS configuration keeps credential-bearing browser recordings
 * disabled while the additional case observes cancellation and remount.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  testMatch: ['next-host.spec.ts', 'vue-owner.spec.ts'],
  metadata: { continuationFramework: 'vue' },
  outputDir: 'test-results/playwright-vue-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4289' },
});
