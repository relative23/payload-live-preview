/**
 * First-use resource contracts run on a clean native Astro production app.
 * Credential-safe recording and zero retries are inherited from the host gate.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-continuation.config';
import { astroResourceRenderer } from './tests/e2e/helpers/astro-resource-versions';

// Astro 4.9.0's container takes no props, so the packed default renders the catalog there and the
// application renderer the verified-context case exercises does not exist.
const packageDefault =
  astroResourceRenderer(
    process.env['PLP_ASTRO_RESOURCE_VERSION'] ?? '7.3.2',
    process.env['PLP_ASTRO_RESOURCE_RENDERER'],
  ) === 'package-default';

export default defineConfig({
  ...base,
  testMatch: 'astro-resources.spec.ts',
  ...(packageDefault
    ? { grepInvert: /keeps concurrent verified users and locales separate/u }
    : {}),
  outputDir: 'test-results/playwright-astro-resources',
});
