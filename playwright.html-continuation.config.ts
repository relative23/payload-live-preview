/**
 * Run the common browser contract against framework-free HTML and a Node host.
 * Credential-bearing requests inherit the recording-disabled base settings.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  testMatch: ['next-host.spec.ts', 'html-owner.spec.ts'],
  metadata: { continuationFramework: 'html' },
  outputDir: 'test-results/playwright-html-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4288' },
});
