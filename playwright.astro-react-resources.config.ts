/**
 * The additional-renderer contract retains the complete resource neighborhood.
 * A second spec distinguishes static React fragments from a live React owner;
 * each file builds an isolated archive consumer with the same exact lock. The explicit React server
 * renderer belongs to the contract, as the islands scope's renderer does to its own.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-resources.config';

process.env['PLP_ASTRO_RESOURCE_RENDERER'] ??= 'react-server';

export default defineConfig({
  ...base,
  testMatch: ['astro-resources.spec.ts', 'astro-react-resources.spec.ts'],
  outputDir: 'test-results/playwright-astro-react-resources',
});
