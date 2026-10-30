/**
 * Standalone React builds separately from the Next.js host and owns a real root.
 * The shared TLS configuration keeps credential-bearing browser recordings
 * disabled while the additional case observes cancellation and remount.
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.next-continuation.config';

export default defineConfig({
  ...base,
  testMatch: ['next-host.spec.ts', 'react-owner.spec.ts'],
  metadata: { continuationFramework: 'react' },
  outputDir: 'test-results/playwright-react-continuation',
  use: { ...base.use, baseURL: 'https://localhost:4291' },
});
