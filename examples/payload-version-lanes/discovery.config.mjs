/**
 * List the exact prepared case set with the repository's pinned test tooling.
 * No dependency consumer, compiler, database, admin or browser is started here;
 * the installed probe uses its own separate configuration and package graph.
 */
import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const prepared = JSON.parse(readFileSync(process.env.PLP_VERSION_LANE_PREPARED, 'utf8'));
process.env.PLP_R6_SURFACE = prepared.surface;
process.env.PLP_R6_WORK = prepared.app;
process.env.PLP_R6_ARCHIVE_SHA = prepared.archiveSHA256;
process.env.PLP_R6_ADMIN = 'http://localhost:' + prepared.ports.admin;
process.env.PLP_R6_FRONTEND = 'http://localhost:' + prepared.ports.frontend;
process.env.PLP_R6_ADMIN_PORT = String(prepared.ports.admin);
process.env.PLP_R6_FRONTEND_PORT = String(prepared.ports.frontend);
if (prepared.lane === 'v2') process.env.PLP_P2_RUN_FILE = prepared.runFile;
const file = resolve(
  directory,
  prepared.lane === 'v2'
    ? prepared.surface === 'dom'
      ? 'v2/browser/payload2.spec.cjs'
      : 'v2/browser/native-lifecycle.spec.cjs'
    : prepared.probe === 'wire'
      ? 'wire.spec.mjs'
      : 'shared/lifecycle.diagnostic.spec.mjs',
);
export default defineConfig({
  testDir: dirname(file),
  testMatch: new RegExp('^' + file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$'),
  outputDir: resolve(prepared.out, 'discovery-artifacts'),
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['json']],
  use: { trace: 'off', video: 'off', screenshot: 'off' },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: devices[
      name === 'chromium'
        ? 'Desktop Chrome'
        : name === 'firefox'
          ? 'Desktop Firefox'
          : 'Desktop Safari'
    ],
  })),
});
