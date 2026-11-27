/**
 * The real-admin targets built for production: strict mode accepts only https admin origins
 * there, so the admin gets an HTTPS front, and the preview's server asks it who the editor is
 * through that front. These read the config as Playwright does, once per target.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

type WebServer = Extract<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>[number];

/** The variables the config reads or writes; each is stubbed so the next test starts clean. */
const TOUCHED = [
  'PLP_REAL_PAYLOAD_TARGET',
  'PLP_REAL_PAYLOAD_SESSION',
  'PLP_REAL_PAYLOAD_PORT',
  'PLP_REAL_PAYLOAD_SURFACE',
  'PLP_REAL_PAYLOAD_PATH',
  'PLP_REAL_PAYLOAD_ADMIN_ORIGIN',
  'PLP_REAL_PAYLOAD_PREVIEW_ORIGIN',
] as const;

async function configFor(target: string): Promise<PlaywrightTestConfig> {
  vi.resetModules();
  for (const name of TOUCHED) vi.stubEnv(name, undefined);
  vi.stubEnv('PLP_REAL_PAYLOAD_TARGET', target);
  const module = await import('../../../playwright.real-payload.config');
  return module.default;
}

function servers(config: PlaywrightTestConfig): WebServer[] {
  return config.webServer as WebServer[];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('real-admin targets built for production', () => {
  it.each([
    ['nextjs-production', 'next', 'PLP_NEXT', '4474'],
    ['sveltekit-production', 'sveltekit', 'PLP_SVELTE', '4475'],
    ['nuxt-production', 'nuxt', 'PLP_NUXT', '4476'],
  ])(
    '%s: the admin, its HTTPS front, then the launcher pointed at both',
    async (target, name, prefix, port) => {
      const config = await configFor(target);
      const [admin, front, preview] = servers(config);
      const certificate = resolve('test-results/real-payload-admin-front/certificate.pem');

      expect(servers(config)).toHaveLength(3);
      expect(admin?.command).toBe('npm --prefix examples/payload-backend run e2e:serve');
      expect(admin?.url).toBe('http://localhost:3001/admin');
      expect(front?.command).toBe('node scripts/admin-tls-front.mjs');
      expect(front?.env).toEqual({
        PLP_ADMIN_ORIGIN: 'https://localhost:3443',
        PLP_ADMIN_INTERNAL_PORT: '3001',
        PLP_ADMIN_CERTIFICATE: certificate,
      });
      expect(preview?.command).toBe(`node ../../scripts/${name}-production-fixture.mjs`);
      expect(preview?.env).toEqual({
        PLP_PRODUCTION_ADMIN_ORIGIN: 'https://localhost:3443',
        PLP_PAYLOAD_SERVER_URL: 'https://localhost:3443',
        NODE_EXTRA_CA_CERTS: certificate,
        [`${prefix}_ORIGIN`]: `https://localhost:${port}`,
        [`${prefix}_INTERNAL_PORT`]: String(Number(port) + 10_000),
      });
      expect(preview?.reuseExistingServer).toBe(false);
      expect(config.use?.baseURL).toBe('https://localhost:3443');
      expect(config.use?.ignoreHTTPSErrors).toBe(true);
      expect(process.env['PLP_REAL_PAYLOAD_PREVIEW_ORIGIN']).toBe(`https://localhost:${port}`);
    },
  );

  it('leaves a development target on plain HTTP, the preview first', async () => {
    const config = await configFor('nuxt');
    const [preview, admin] = servers(config);

    expect(servers(config)).toHaveLength(2);
    expect(preview?.command).toBe('npx nuxt dev --port 4476');
    expect(preview?.env).toEqual({
      PAYLOAD_ADMIN_ORIGIN: 'http://localhost:3001',
      PLP_PAYLOAD_SERVER_URL: 'http://localhost:3001',
    });
    expect(admin?.command).toBe('npm --prefix examples/payload-backend run e2e:serve');
    expect(config.use?.baseURL).toBe('http://localhost:3001');
    expect(config.use?.ignoreHTTPSErrors).toBe(false);
    expect(process.env['PLP_REAL_PAYLOAD_ADMIN_ORIGIN']).toBe('http://localhost:3001');
  });

  it('the launchers take the admin origin a run names, and their own otherwise', () => {
    for (const launcher of [
      'scripts/next-production-fixture.mjs',
      'scripts/node-production-fixture.mjs',
    ]) {
      const source = readFileSync(launcher, 'utf8');
      expect(source).toContain(
        "const adminOrigin = process.env['PLP_PRODUCTION_ADMIN_ORIGIN'] ?? publicUrl.origin;",
      );
      expect(source).toContain('PAYLOAD_ADMIN_ORIGIN: adminOrigin');
    }
  });

  it('the admin front drops Critical-CH and keeps Accept-CH', () => {
    const front = readFileSync('scripts/admin-tls-front.mjs', 'utf8');
    expect(front).toContain("delete response.headers['critical-ch'];");
    expect(front).not.toContain("delete response.headers['accept-ch']");
  });
});
