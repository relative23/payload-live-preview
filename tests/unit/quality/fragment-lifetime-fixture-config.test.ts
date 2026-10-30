/**
 * Native lifetime evidence must use production servers and retain strict failure
 * reporting. Credentials stay inherited, outside serialized runner settings.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('playwright.fragment-lifetime.config.ts', 'utf8');

describe('fragment lifetime production fixture', () => {
  it('builds before starting a fresh native server without retrying failures', () => {
    expect(config).toContain('npm run build &&');
    expect(config).toContain('reuseExistingServer: false');
    expect(config).toContain('retries: 0');
    expect(config).toContain('failOnFlakyTests: true');
    expect(config).toContain('playwright-zero-skip-reporter.ts');
  });

  it('does not serialize inherited credentials into the JSON report', () => {
    expect(config).not.toContain('...process.env');
    const environment = config.slice(config.indexOf('env: {'), config.indexOf('url: `${origin}'));
    expect(environment).not.toContain('PLP_LIFETIME_PROBE_KEY');
    expect(config).toContain("randomBytes(32).toString('hex')");
    expect(config).toContain("trace: 'off'");
  });

  it('separates direct and TLS evidence and pins raw TLS requests to the local certificate', () => {
    expect(config).toContain('PLP_LIFETIME_TRANSPORT');
    expect(config).toContain('${name}/${transport}/report.json');
    expect(config).toContain('The TLS fixture proxy exists only for nextjs and sveltekit.');
    const probe = readFileSync('tests/e2e/lifetime/fragment-lifetime.spec.ts', 'utf8');
    expect(probe).toContain('ca: readFileSync(path)');
    expect(probe).not.toContain('rejectUnauthorized: false');
    for (const name of ['next', 'sveltekit', 'nuxt', 'astro', 'html']) {
      const launcher = readFileSync(`scripts/${name}-production-fixture.mjs`, 'utf8');
      const runner =
        name === 'next' ? launcher : readFileSync('scripts/node-production-fixture.mjs', 'utf8');
      if (name !== 'next') {
        expect(launcher).toContain("from './node-production-fixture.mjs'");
        expect(launcher).toContain(`runNodeProductionFixture('${name}')`);
      }
      expect(runner).toContain("import { startTlsFront } from './tls-front.mjs';");
    }
    const front = readFileSync('scripts/tls-front.mjs', 'utf8');
    expect(front).toContain("process.env['PLP_LIFETIME_CERTIFICATE']");
    expect(front).toContain('copyFileSync(certificatePath, probeCertificate)');
    expect(front).not.toContain('copyFileSync(keyPath');
  });
});
