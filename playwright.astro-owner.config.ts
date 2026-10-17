/**
 * Page-owned React commits are independent of the raw fragment hydration probe.
 * Keep native builds, three browsers and the credential-safe zero-retry policy.
 * The build-hash island policy belongs to the contract, as it does for the islands scope: under the
 * default policy the strict CSP refuses the island bootstrap and no case gets past the ready signal.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-resources.config';

process.env['PLP_ASTRO_ISLAND_CSP'] ??= 'build-hashes';

export default defineConfig({
  ...base,
  testMatch: 'astro-owner.spec.ts',
  outputDir: 'test-results/playwright-astro-owner',
});
