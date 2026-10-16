/**
 * Native client directives are characterized separately from React server HTML.
 * This scope inherits the same private recording policy and zero retries.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.astro-resources.config';

export default defineConfig({
  ...base,
  testMatch: 'astro-islands.spec.ts',
  outputDir: 'test-results/playwright-astro-islands',
});
