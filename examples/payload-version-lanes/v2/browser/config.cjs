/**
 * The browser harness controls a fresh run-owned admin and preview. Credential
 * tracing, videos and screenshots are disabled; reports contain assertions and
 * selected protocol data, never the login payload or session cookie.
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { defineConfig, devices } = require('./test-tool.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: new RegExp(
    '^' +
      join(
        __dirname,
        settings.surface === 'dom' ? 'payload2.spec.cjs' : 'native-lifecycle.spec.cjs',
      ).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') +
      '$',
  ),
  outputDir: join(settings.run, 'browser-artifacts'),
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  failOnFlakyTests: true,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: [[join(__dirname, 'reporter.cjs')]],
  use: { baseURL: settings.admin, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ].filter((project) => settings.browsers.includes(project.name)),
});
