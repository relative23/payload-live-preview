/**
 * The quickstarts of the README, each rebuilt in a fresh project with a fresh
 * install of its framework. No fixture server runs; a spec builds and serves
 * its own project, one at a time, and a failure is not retried.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './tests/e2e/quickstart',
  outputDir: 'test-results/playwright-quickstart',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  webServer: [],
  timeout: 60_000,
});
