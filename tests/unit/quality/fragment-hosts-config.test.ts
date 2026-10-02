/**
 * The host and proxy matrix keeps the lifetime suite's strict reporting, passes
 * the probe credential by name only, trusts the local CA and nothing broader, and
 * names only proxy files that exist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('playwright.fragment-hosts.config.ts', 'utf8');
const specs = [
  'tests/e2e/lifetime/fragment-body-limit.spec.ts',
  'tests/e2e/lifetime/fragment-early-refusal.spec.ts',
  'tests/e2e/lifetime-h2/fragment-lifetime-h2.spec.ts',
  'tests/e2e/lifetime-proxy/fragment-proxy-upload.spec.ts',
  'tests/e2e/lifetime-proxy/fragment-large-refusal.spec.ts',
  'tests/e2e/lifetime-browser/fragment-oversize-page.spec.ts',
];

describe('fragment hosts fixture', () => {
  it('starts every server fresh and fails on the first failure or skip', () => {
    expect(config).toContain('reuseExistingServer: false');
    expect(config).toContain('retries: 0');
    expect(config).toContain('failOnFlakyTests: true');
    expect(config).toContain('playwright-zero-skip-reporter.ts');
    expect(config).toContain("trace: 'off'");
  });

  it('keeps the probe credential out of the serialized settings', () => {
    expect(config).not.toContain('...process.env');
    expect(config).not.toMatch(/env:\s*\{[^}]*PLP_LIFETIME_PROBE_KEY/u);
    expect(config).toContain("randomBytes(32).toString('hex')");
    // `docker run -e NAME` passes the value from the environment, never inline.
    expect(config).toContain('-e PLP_LIFETIME_PROBE_KEY ');
  });

  it('runs containers with an init process so a stop signal reaches the server', () => {
    expect(config).toContain('docker run --rm --init');
    expect(config).toContain('--network host');
  });

  it('names only proxy files that exist', () => {
    const named = [...config.matchAll(/\/proxies\/([\w.-]+)/gu)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) {
      expect(existsSync(`tests/fixtures/web-hosts/proxies/${file}`), file).toBe(true);
    }
  });

  it('trusts the local CA and never turns certificate checks off', () => {
    for (const path of specs) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toContain('rejectUnauthorized');
      expect(source, path).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    }
    expect(config).toContain('PLP_LIFETIME_CERTIFICATE');
  });
});
