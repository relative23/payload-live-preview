/**
 * The native Astro host is a locked consumer, not the existing static demo.
 * These structural checks retain its installation and ownership boundaries;
 * actual authorization and rendering are measured by the browser contract.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const source = (path: string): string => read(`tests/fixtures/astro-continuation/${path}.fixture`);

describe('native Astro host fixture configuration', () => {
  it('pins the SSR dependency graph without changing the static example', () => {
    const manifest = JSON.parse(read('tests/fixtures/astro-host-deps/package.json')) as {
      dependencies: Record<string, string>;
      overrides: Record<string, string>;
      allowScripts: Record<string, boolean>;
    };
    const lock = JSON.parse(read('tests/fixtures/astro-host-deps/package-lock.json')) as {
      packages: Record<string, { version: string }>;
    };
    for (const [name, version] of Object.entries({
      astro: '7.3.2',
      '@astrojs/node': '11.1.4',
      vite: '8.1.4',
    })) {
      expect(manifest.dependencies[name]).toBe(version);
      expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
    }
    expect(manifest.overrides['esbuild']).toBe('0.28.1');
    expect(manifest.allowScripts).toEqual({ 'esbuild@0.28.1': true, 'fsevents@2.3.3': false });
    expect(read('tests/fixtures/astro-host-deps/.npmrc')).toBe(
      'strict-allow-scripts=true\ninstall-links=true\n',
    );
  });

  it('keeps native Node SSR and ClientRouter rather than a custom navigation substitute', () => {
    expect(source('astro.config.mjs')).toContain("output: 'server'");
    expect(source('astro.config.mjs')).toContain("node({ mode: 'standalone' })");
    expect(source('astro.config.mjs')).toContain('allowedDomains:');
    expect(source('astro.config.mjs')).not.toContain('checkOrigin: false');
    const page = source('src/pages/continuation/[editor]/[locale].astro');
    expect(page).toContain("from 'astro:transitions'");
    expect(page).toContain('<ClientRouter');
    expect(page).toContain('Astro.locals.livePreviewAuthorization');
    expect(page).toContain('Astro.response.status = 403');
  });

  it('shares a single verified request decision with the packed middleware', () => {
    const middleware = source('src/middleware.ts');
    expect(middleware).toContain("from 'payload-live-preview/astro'");
    expect(middleware).toContain('await active.host.page(request)');
    expect(middleware).toContain('authorizePreview: () => page?.authorization ?? null');
    expect(middleware).toContain('locals: context.locals');
    expect(middleware).toContain('autoInject: false');
    const host = source('src/server/host.ts');
    expect(host).toContain("process.env.PLP_ASTRO_HOST_ENABLED !== 'local-test-only'");
    expect(host).toContain("request.headers.get('x-forwarded-proto') !== 'https'");
    expect(host).not.toContain('searchParams.delete');
    for (const header of ['private, no-store', 'no-referrer', 'Cookie']) {
      expect(middleware).toContain(header);
    }
  });

  it('keeps credentials server-side and gives the custom element only public scope', () => {
    const component = source('src/components/Preview.astro');
    expect(component).toContain('JSON.stringify({ id: data.id, path, locale, origin })');
    expect(component).not.toContain('JSON.stringify(Astro.locals)');
    expect(component).not.toContain('HOST_CONFIG');
    expect(component).not.toContain('set:html');
    expect(source('src/pages/index.astro')).not.toContain('payload-live-preview');
  });

  it('ties the single client writer and its pending requests to native element lifetime', () => {
    const component = source('src/components/Preview.astro');
    const client = source('src/client/preview.ts');
    expect(component).toContain('connectedCallback()');
    expect(component).toContain('disconnectedCallback()');
    expect(component).toContain('this.stop?.()');
    expect(client).toContain("from 'payload-live-preview/client'");
    expect(client).toContain('event.cancel()');
    expect(client).toContain("defaults: 'v2'");
    expect(client).toContain('lifetime.abort()');
    expect(client).toContain('client.destroy()');
    expect(client).toContain('signal.aborted || !root.isConnected');
    expect(client).not.toContain('innerHTML');
  });

  it('uses a separate TLS configuration with the credential-safe base', () => {
    const config = read('playwright.astro-continuation.config.ts');
    const launcher = read('scripts/astro-production-fixture.mjs');
    const runner = read('scripts/node-production-fixture.mjs');
    expect(config).toContain("from './playwright.next-continuation.config'");
    expect(config).toContain("continuationFramework: 'astro'");
    expect(launcher).toContain("runNodeProductionFixture('astro')");
    expect(runner).toContain("'dist/server/entry.mjs'");
    expect(runner).toContain("proxy.listen(publicPort, '127.0.0.1'");
    expect(runner).toContain('bindProxyLifetime(incoming, outgoing, upstream)');
  });
});
