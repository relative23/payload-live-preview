/**
 * Exercise exactly one isolated native consumer in three engines with no retries.
 * Every generated path stays in its new work directory; a pre-release run measures
 * that family only and cannot grant a stable-family or Nodefloor guarantee.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const directory = dirname(fileURLToPath(import.meta.url));
const work = process.env.PLP_R6_WORK;
const prepared = JSON.parse(readFileSync(process.env.PLP_VERSION_LANE_PREPARED, 'utf8'));
assert.equal(work, prepared.app);
assert.equal(process.env.PLP_R6_SURFACE, prepared.surface);
assert.equal(process.env.PLP_R6_ARCHIVE_SHA, prepared.archiveSHA256);
const ps = spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
assert.equal(ps.status, 0);
assert.ok(
  !/(?:@stryker-mutator\/core|\.bin\/stryker|stryker run|resume-run-nightly\.mjs)/u.test(ps.stdout),
);
const admin = 'http://localhost:' + prepared.ports.admin;
const frontend = 'http://localhost:' + prepared.ports.frontend;
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const env = {
  ...process.env,
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
  PLP_R6_ADMIN: admin,
  PLP_R6_FRONTEND: frontend,
  PLP_R6_ADMIN_PORT: String(prepared.ports.admin),
  PLP_R6_FRONTEND_PORT: String(prepared.ports.frontend),
  DATABASE_URI: 'file:' + prepared.database,
  PAYLOAD_CONFIG_PATH: resolve(work, 'cms/payload.config.ts'),
};
process.env.PLP_R6_ADMIN = admin;
process.env.PLP_R6_FRONTEND = frontend;
const testFile = resolve(
  directory,
  prepared.probe === 'wire' ? 'wire.spec.mjs' : 'lifecycle.diagnostic.spec.mjs',
);
const exact = new RegExp('^' + testFile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$');
export default defineConfig({
  testDir: directory,
  testMatch: exact,
  outputDir: resolve(work, 'browser-artifacts'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  timeout: 60_000,
  reporter: [[resolve(directory, 'reporter.mjs')]],
  use: { baseURL: admin, trace: 'off', video: 'off', screenshot: 'off' },
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
  webServer: [
    {
      command:
        'exec ' + quote(process.execPath) + ' ' + quote(resolve(work, 'frontend/server.mjs')),
      cwd: resolve(work, 'frontend'),
      env: { ...env, PORT: String(prepared.ports.frontend) },
      url: frontend + '/__r6/identity',
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      timeout: 30_000,
    },
    {
      command: 'exec ' + quote(process.execPath) + ' ' + quote(resolve(directory, 'serve-cms.mjs')),
      cwd: resolve(work, 'cms'),
      env,
      url: admin + '/admin',
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      timeout: 180_000,
    },
  ],
});
