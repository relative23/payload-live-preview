/**
 * First-use resource contracts run on a clean native Astro production app.
 * Credential-safe recording and zero retries are inherited from the host gate.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-continuation.config';

export default defineConfig({
  ...base,
  testMatch: 'astro-resources.spec.ts',
  outputDir: 'test-results/playwright-astro-resources',
});
