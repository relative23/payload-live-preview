/**
 * The SvelteKit fixture has one server-only source for its trusted admin
 * origin, token audience and signing secret. Development keeps the loopback
 * E2E origin, while a production build can only select an HTTPS origin. Its
 * SvelteKit 3 twin keeps the same contract through SvelteKit 3's own modules.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE = resolve(ROOT, 'examples/sveltekit-payload');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('SvelteKit fixture preview configuration', () => {
  it('keeps the Node adapter output out of source formatting and version control', () => {
    for (const file of ['.gitignore', '.prettierignore']) {
      const rules = read(file).split('\n');
      expect(rules).toContain('examples/sveltekit-payload/build/');
      expect(rules).not.toContain('examples/sveltekit-payload/');
    }
  });

  it('uses one server-only origin for the message allowlist and token audience', () => {
    const hooks = read('examples/sveltekit-payload/src/hooks.server.ts');
    const config = read('examples/sveltekit-payload/src/lib/preview.server.ts');
    const sourceRoot = resolve(FIXTURE, 'src');
    const configImporters = sourceFiles(sourceRoot)
      .map((path) => ({
        path: relative(sourceRoot, path).replaceAll('\\', '/'),
        source: readFileSync(path, 'utf8'),
      }))
      .filter(({ source }) => source.includes('$lib/preview'));

    expect(existsSync(resolve(FIXTURE, 'src/lib/preview.ts'))).toBe(false);
    expect(configImporters.map(({ path }) => path).sort()).toEqual([
      'hooks.server.ts',
      'routes/+page.server.ts',
      'routes/hybrid/host/+page.server.ts',
      'routes/payload/fragment/+server.ts',
      'routes/preview-token/+server.ts',
    ]);
    for (const { source } of configImporters) {
      expect(source).toContain("from '$lib/preview.server'");
      expect(source).not.toContain("from '$lib/preview'");
    }
    expect(hooks).toContain('allowedOrigins: [PREVIEW_ADMIN_ORIGIN]');
    expect(hooks).not.toMatch(/allowedOrigins:\s*\[\s*['"]http:/u);
    expect(config).toContain('export const PREVIEW_AUDIENCE = PREVIEW_ADMIN_ORIGIN;');
  });

  it('separates the loopback development origin from an HTTPS-only production path', () => {
    const config = read('examples/sveltekit-payload/src/lib/preview.server.ts');

    expect(config).toContain("import { dev } from '$app/environment';");
    expect(config).toContain("import { env } from '$env/dynamic/private';");
    expect(config).toContain("const DEVELOPMENT_ADMIN_ORIGIN = 'http://localhost:4175';");
    expect(config).toMatch(/PRODUCTION_ADMIN_ORIGIN\s*=\s*['"]https:\/\//u);
    expect(config).toContain("if (!dev && url.protocol !== 'https:')");
    expect(config).toContain('env.PAYLOAD_ADMIN_ORIGIN');
  });

  it('keeps the native development fixture and browser tests on port 4175', () => {
    const manifest = JSON.parse(read('examples/sveltekit-payload/package.json')) as {
      scripts?: Record<string, string>;
    };
    const playwright = read('playwright.config.ts');
    const config = read('examples/sveltekit-payload/src/lib/preview.server.ts');

    expect(manifest.scripts?.['dev']).toBe('vite dev --port 4175');
    expect(playwright).toContain("url: 'http://localhost:4175/admin.html'");
    expect(config).toContain("const DEVELOPMENT_ADMIN_ORIGIN = 'http://localhost:4175';");
  });

  it('starts the optimized fixture through an explicit Node adapter and HTTPS gate', () => {
    const fixtureManifest = JSON.parse(read('examples/sveltekit-payload/package.json')) as {
      devDependencies?: Record<string, string>;
    };
    const rootManifest = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    const svelteConfig = read('examples/sveltekit-payload/svelte.config.js');
    const playwright = read('playwright.sveltekit-production.config.ts');
    const launcher = read('scripts/sveltekit-production-fixture.mjs');
    const productionFixture = read('scripts/node-production-fixture.mjs');

    expect(fixtureManifest.devDependencies?.['@sveltejs/adapter-node']).toBeDefined();
    expect(svelteConfig).toContain("from '@sveltejs/adapter-node'");
    expect(rootManifest.scripts?.['test:e2e:sveltekit-production']).toBe(
      'playwright test --config playwright.sveltekit-production.config.ts',
    );
    expect(playwright).toContain("command: 'node scripts/sveltekit-production-fixture.mjs'");
    expect(playwright).toContain('reuseExistingServer: false');
    expect(launcher).toContain("from './node-production-fixture.mjs'");
    expect(launcher).toContain("runNodeProductionFixture('sveltekit')");
    expect(productionFixture).toContain("NODE_ENV: 'production'");
    expect(productionFixture).toContain(
      "const adminOrigin = process.env['PLP_PRODUCTION_ADMIN_ORIGIN'] ?? publicUrl.origin;",
    );
    expect(productionFixture).toContain('PAYLOAD_ADMIN_ORIGIN: adminOrigin');
  });
});

describe('SvelteKit 3 fixture preview configuration', () => {
  const KIT3 = resolve(ROOT, 'examples/sveltekit3-payload');

  it('keeps its Node adapter output out of source formatting and version control', () => {
    for (const file of ['.gitignore', '.prettierignore']) {
      const rules = read(file).split('\n');
      expect(rules).toContain('examples/sveltekit3-payload/build/');
      expect(rules).not.toContain('examples/sveltekit3-payload/');
    }
  });

  it('imports the one server-only origin through the #lib subpath with its extension', () => {
    const sourceRoot = resolve(KIT3, 'src');
    const configImporters = sourceFiles(sourceRoot)
      .map((path) => ({
        path: relative(sourceRoot, path).replaceAll('\\', '/'),
        source: readFileSync(path, 'utf8'),
      }))
      .filter(({ source }) => /[#$]lib\/preview/u.test(source));

    expect(configImporters.map(({ path }) => path).sort()).toEqual([
      'hooks.server.ts',
      'routes/+page.server.ts',
      'routes/hybrid/host/+page.server.ts',
      'routes/payload/fragment/+server.ts',
      'routes/preview-token/+server.ts',
    ]);
    for (const { source } of configImporters) {
      expect(source).toContain("from '#lib/preview.server.js'");
      expect(source).not.toContain('$lib/');
    }
    const manifest = JSON.parse(read('examples/sveltekit3-payload/package.json')) as {
      imports?: Record<string, string>;
    };
    expect(manifest.imports).toEqual({ '#lib/*': './src/lib/*' });
    expect(read('examples/sveltekit3-payload/src/hooks.server.ts')).toContain(
      'allowedOrigins: [PREVIEW_ADMIN_ORIGIN]',
    );
  });

  it('reads its private variables from $app/env and keeps production HTTPS-only', () => {
    const config = read('examples/sveltekit3-payload/src/lib/preview.server.ts');
    const declared = read('examples/sveltekit3-payload/src/env.ts');

    expect(config).toContain("import { dev } from '$app/env';");
    expect(config).toContain("} from '$app/env/private';");
    expect(config).not.toContain('$env/');
    expect(config).toContain("const DEVELOPMENT_ADMIN_ORIGIN = 'http://localhost:4175';");
    expect(config).toMatch(/PRODUCTION_ADMIN_ORIGIN\s*=\s*['"]https:\/\//u);
    expect(config).toContain("if (!dev && url.protocol !== 'https:')");
    for (const name of ['PAYLOAD_ADMIN_ORIGIN', 'PREVIEW_TOKEN_SECRET', 'PLP_PAYLOAD_SERVER_URL']) {
      expect(declared).toContain(`${name}: { schema: (input) => input ?? '' }`);
    }
  });

  it('serves the browser tests on port 4175 only when the run selects it', () => {
    const manifest = JSON.parse(read('examples/sveltekit3-payload/package.json')) as {
      scripts?: Record<string, string>;
    };
    const playwright = read('playwright.config.ts');

    expect(manifest.scripts?.['dev']).toBe('vite dev --port 4175');
    expect(playwright).toContain("process.env['PLP_SVELTEKIT_FIXTURE'] ?? 'sveltekit-payload'");
    expect(playwright).toContain("svelteKitFixture !== 'sveltekit3-payload'");
    expect(playwright).toContain('command: `npm --prefix examples/${svelteKitFixture} run dev`');
  });

  it('configures the Node adapter in Vite and takes its public origin from the build', () => {
    const viteConfig = read('examples/sveltekit3-payload/vite.config.ts');
    const productionFixture = read('scripts/node-production-fixture.mjs');

    expect(existsSync(resolve(KIT3, 'svelte.config.js'))).toBe(false);
    expect(viteConfig).toContain("import adapter from '@sveltejs/adapter-node';");
    expect(viteConfig).toContain('adapter: adapter()');
    expect(viteConfig).toContain("paths: { origin: process.env['ORIGIN'] }");
    expect(productionFixture).toContain('ORIGIN: publicUrl.origin');
    expect(productionFixture).toContain("spawnSync('npm', ['run', 'build']");
  });
});
