/**
 * The optional HTML data service must not hide a framework requirement.
 * These source contracts accompany native browser, archive and real ACL proof;
 * a structural assertion alone is not a rendered preview or security verdict.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const source = (path: string): string =>
  read('tests/fixtures/html-continuation/' + path + '.fixture');

describe('framework-free HTML host fixture', () => {
  it('keeps internal continuation listeners below the measured ephemeral port range', () => {
    const helper = read('tests/e2e/helpers/native-continuation.ts');
    expect(helper).toContain('String(Number(port) + 10_000)');
    expect(helper).not.toContain('port}0');
  });

  it('builds only the packed browser entry and records its actual byte cost', () => {
    const build = source('build.mjs');
    expect(build).toContain("import.meta.resolve('payload-live-preview/client')");
    expect(build).toContain('require.resolve(name)');
    expect(build).toContain("code: 'MODULE_NOT_FOUND'");
    expect(build).toContain('bytes[path] = contents.byteLength');
    expect(build).not.toContain('esbuild.build');
    const manifest = JSON.parse(read('examples/pure-html/package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).toEqual(['payload-live-preview']);
  });

  it('serves an exact asset allowlist rather than arbitrary files or private configuration', () => {
    const service = source('server.mjs');
    expect(service).toContain('withNativeHostRequest(incoming, url, handle)');
    expect(service).toContain('assets.get(url.pathname)');
    expect(service).toContain("['/preview.js'");
    expect(service).toContain("['/client.js'");
    expect(service).not.toContain('readFileSync(url.pathname)');
    expect(service).toContain("process.env.PLP_HTML_HOST_ENABLED === 'local-test-only'");
    expect(service).toContain('response.headers.getSetCookie()');
    expect(service).toContain("'127.0.0.1'");
  });

  it('stops requests on native element removal and page departure without a custom router', () => {
    const client = source('preview.mjs');
    expect(client).toContain("import { LivePreviewClient } from './client.js'");
    expect(client).toContain('event.cancel()');
    expect(client).toContain("defaults: 'v2'");
    expect(client).toContain('signal.aborted || !root.isConnected');
    expect(client).toContain('lifetime.abort()');
    expect(client).toContain('client.destroy()');
    expect(client).toContain('disconnectedCallback()');
    expect(client).toContain("'pagehide'");
    expect(client).toContain('if (event.persisted) location.reload()');
    expect(client).not.toContain('innerHTML');
    expect(client).not.toContain('pushState');
  });

  it('retains strict isolated installs, peer absence and recording-disabled TLS execution', () => {
    const helper = read('tests/e2e/helpers/native-continuation.ts');
    expect(helper).toContain('probeUnavailableDependencies(app,');
    expect(helper).toContain("assert.deepEqual(installed, ['payload-live-preview'])");
    expect(helper).toContain('PACKAGE_SMOKE_NPMRC');
    const config = read('playwright.html-continuation.config.ts');
    expect(config).toContain("from './playwright.next-continuation.config'");
    expect(config).toContain("continuationFramework: 'html'");
    expect(config).toContain("'html-owner.spec.ts'");
    expect(read('scripts/html-production-fixture.mjs')).toContain(
      "runNodeProductionFixture('html')",
    );
    expect(read('scripts/node-production-fixture.mjs')).toContain("'dist/server.mjs'");
  });
});
