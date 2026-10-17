/**
 * Native client directives are characterized separately from React server HTML.
 * This scope inherits the same private recording policy and zero retries. The React
 * renderer and the build-hash CSP belong to the contract, not to the caller; a caller
 * may still name another value to run a control against it.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-resources.config';

process.env['PLP_ASTRO_RESOURCE_RENDERER'] ??= 'react-islands';
process.env['PLP_ASTRO_ISLAND_CSP'] ??= 'build-hashes';

export default defineConfig({
  ...base,
  testMatch: 'astro-islands.spec.ts',
  outputDir: 'test-results/playwright-astro-islands',
});
