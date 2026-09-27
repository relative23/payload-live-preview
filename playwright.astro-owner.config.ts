/**
 * Page-owned React commits are independent of the raw fragment hydration probe.
 * Keep native builds, three browsers and the credential-safe zero-retry policy.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-resources.config';

export default defineConfig({
  ...base,
  testMatch: 'astro-owner.spec.ts',
  outputDir: 'test-results/playwright-astro-owner',
});
