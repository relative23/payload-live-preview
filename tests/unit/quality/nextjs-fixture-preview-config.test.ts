/**
 * The Next.js fixture must keep its development loopback convenient without
 * feeding that HTTP origin into strict production policy. These contracts also
 * keep the signing secret on the server and every caller on one origin value.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const ORIGIN_MODULE = resolve(ROOT, 'examples/nextjs-payload/preview-origin.mjs');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function resolveFixtureOrigin(nodeEnv: string, configured?: string) {
  const moduleUrl = pathToFileURL(ORIGIN_MODULE).href;
  const source = [
    `import { resolvePreviewAdminOrigin } from ${JSON.stringify(moduleUrl)};`,
    'process.stdout.write(resolvePreviewAdminOrigin(process.env));',
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      ...(configured === undefined ? {} : { PAYLOAD_ADMIN_ORIGIN: configured }),
    },
  });
}

describe('Next.js fixture preview configuration', () => {
  it('uses one origin for inline, asset, config, redirect parsing and token audience', () => {
    const preview = read('examples/nextjs-payload/app/preview.ts');
    const inlineLayout = read('examples/nextjs-payload/app/(inline)/layout.tsx');
    const assetLayout = read('examples/nextjs-payload/app/(asset)/layout.tsx');
    const config = read('examples/nextjs-payload/next.config.mjs');
    const entry = read('examples/nextjs-payload/app/preview-session/route.ts');
    const fragment = read('examples/nextjs-payload/app/(inline)/payload/fragment/route.ts');

    expect(preview).toContain("import 'server-only';");
    expect(preview).toContain("import { PREVIEW_ADMIN_ORIGIN } from '../preview-origin.mjs';");
    expect(preview).toContain('export const SITE = PREVIEW_ADMIN_ORIGIN;');
    expect(preview).toContain('audience: SITE');
    expect(inlineLayout).toContain('allowedOrigins: [SITE]');
    expect(assetLayout).toContain('allowedOrigins: [SITE]');
    expect(config).toContain("import { PREVIEW_ADMIN_ORIGIN } from './preview-origin.mjs';");
    expect(config).toContain('allowedOrigins: [PREVIEW_ADMIN_ORIGIN]');
    expect(entry).toContain("import { PREVIEW_COOKIE, SITE, mintSessionToken } from '../preview';");
    expect(entry).toContain('new URL(requested, SITE)');
    expect(entry).toContain("new URL(SITE).protocol === 'https:' ? '; Secure' : ''");
    expect(fragment).toContain("import { SITE, strategy } from '../../../preview';");
    expect(fragment).toContain('allowedOrigins: [SITE]');

    for (const source of [preview, inlineLayout, assetLayout, config, entry, fragment]) {
      expect(source).not.toMatch(/allowedOrigins:\s*\[\s*['"]http:/u);
    }
  });

  it('allows the loopback origin only in development and requires HTTPS in production', () => {
    const development = resolveFixtureOrigin('development');
    expect(development.status, development.stderr).toBe(0);
    expect(development.stdout).toBe('http://localhost:4174');

    const production = resolveFixtureOrigin('production', 'https://preview.example.test/path');
    expect(production.status, production.stderr).toBe(0);
    expect(production.stdout).toBe('https://preview.example.test');

    const unsafe = resolveFixtureOrigin('production', 'http://localhost:4174');
    expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain('PAYLOAD_ADMIN_ORIGIN must use HTTPS in production');
  });

  it('keeps the token secret server-only and the normal development port unchanged', () => {
    const preview = read('examples/nextjs-payload/app/preview.ts');
    const manifest = JSON.parse(read('examples/nextjs-payload/package.json')) as {
      scripts?: Record<string, string>;
    };
    const playwright = read('playwright.config.ts');

    expect(preview).toContain("process.env['PREVIEW_TOKEN_SECRET']");
    expect(preview).not.toMatch(/export\s+(?:const|let|var)\s+PREVIEW_SECRET/u);
    expect(manifest.scripts?.['dev']).toBe('next dev --port 4174');
    expect(playwright).toContain("url: 'http://localhost:4174/admin.html'");
  });
});
