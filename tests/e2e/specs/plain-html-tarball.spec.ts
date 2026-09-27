import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  createPackageArchiveEvidence,
  parseNpmPackReport,
  type PackageArchiveEvidence,
} from '../../../scripts/package-artifact';
import {
  initializeConsumer,
  installStrictly,
  probeUnavailableDependencies,
} from '../../../scripts/package-smoke-consumer';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { sanitizeNpmScriptEnvironment } from '../../../scripts/release-contracts';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The existing pure-HTML example is deliberately convenient for contributors
 * and resolves the package through a workspace link. This fixture proves the
 * release shape separately: an isolated consumer installs only the exact npm
 * archive and writes static pages from its root and lean entries.
 */

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const NONCE = 'H20Nonce_2026';
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

interface PackedHtmlFixture {
  readonly archive: PackageArchiveEvidence;
  readonly origin: string;
  readonly root: string;
  readonly server: Server;
}

let fixture: PackedHtmlFixture | undefined;

function commandFailure(
  label: string,
  result: { readonly stdout: string; readonly stderr: string },
) {
  return new Error(`${label}:\n${detailFor(result)}`);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture has no TCP port');
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
  });
}

function fixtureServer(dist: string): Server {
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const pathname = url.pathname === '/' ? '/admin.html' : decodeURIComponent(url.pathname);
        const file = resolve(dist, `.${pathname}`);
        const fromDist = relative(dist, file);
        if (isAbsolute(fromDist) || fromDist.startsWith(`..${sep}`) || fromDist === '..') {
          response.writeHead(403).end('forbidden');
          return;
        }
        const body = await readFile(file);
        const headers: Record<string, string> = {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        };
        if (pathname === '/nonce.html') {
          headers['content-security-policy'] =
            `default-src 'none'; script-src 'nonce-${NONCE}'; frame-ancestors 'self'`;
        }
        response.writeHead(200, headers).end(body);
      } catch {
        response.writeHead(404).end('not found');
      }
    })();
  });
}

async function createFixture(): Promise<PackedHtmlFixture> {
  const root = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-html-tarball-'));
  let server: Server | undefined;
  try {
    const pack = run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      REPOSITORY_ROOT,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (pack.status !== 0) throw commandFailure('npm pack failed', pack);
    const report = parseNpmPackReport(pack.stdout);
    const tarball = resolve(root, report.filename);
    const archive = await createPackageArchiveEvidence(tarball, report);

    const consumer = resolve(root, 'consumer');
    await initializeConsumer(consumer);
    const install = installStrictly(consumer, [tarball]);
    if (install.status !== 0) throw commandFailure('isolated tarball install failed', install);
    const unavailable = probeUnavailableDependencies(consumer, [
      'astro',
      'next',
      'nuxt',
      'react',
      'react-dom',
      'svelte',
      'vue',
    ]);
    if (unavailable.status !== 0) {
      throw commandFailure('framework-free consumer resolved a framework peer', unavailable);
    }

    const installedPackage = resolve(consumer, 'node_modules/payload-live-preview');
    if ((await lstat(installedPackage)).isSymbolicLink()) {
      throw new Error('packed package was installed as a symbolic link');
    }
    const installedRealPath = await realpath(installedPackage);
    if (!installedRealPath.startsWith(`${await realpath(consumer)}${sep}`)) {
      throw new Error(`packed package escaped the isolated consumer: ${installedRealPath}`);
    }

    const dist = resolve(consumer, 'site');
    server = fixtureServer(dist);
    const port = await listen(server);
    const origin = `http://127.0.0.1:${String(port)}`;
    const builder = resolve(consumer, 'build.mjs');
    await writeFile(
      builder,
      `
      import { mkdir, writeFile } from 'node:fs/promises';
      import { resolve } from 'node:path';
      import { generateInlineScript, wrapWithScriptTag } from 'payload-live-preview';
      import { LEAN_RUNTIME } from 'payload-live-preview/lean';

      const origin = process.argv[2];
      const nonce = process.argv[3];
      const dist = resolve('site');
      const options = { allowedOrigins: [origin], debug: true, debounceMs: 0 };
      const full = generateInlineScript(options);
      const lean = generateInlineScript({ ...options, runtime: LEAN_RUNTIME });
      const body =
        '<p data-payload-field="subtitle" data-testid="subtitle"></p>' +
        '<ul data-payload-field="tags" data-payload-type="array" ' +
        'data-payload-array-template="<li>{{value}}</li>" data-testid="tags"><li>baseline</li></ul>';
      const page = (runtime, runtimeNonce, blockedProbe = '') =>
        '<!doctype html><html><head><meta charset="utf-8">' +
        wrapWithScriptTag(runtime, runtimeNonce === undefined ? {} : { nonce: runtimeNonce }) +
        blockedProbe + '</head><body>' + body + '</body></html>';
      const admin = '<!doctype html><html><body>' +
        '<iframe data-testid="preview-frame" title="Live preview"></iframe>' +
        '<script>const pages=["/full.html","/lean.html","/nonce.html"];' +
        'const requested=new URLSearchParams(location.search).get("target");' +
        'document.querySelector("iframe").src=pages.includes(requested)?requested:pages[0];</script>' +
        '</body></html>';

      await mkdir(dist, { recursive: true });
      await Promise.all([
        writeFile(resolve(dist, 'admin.html'), admin),
        writeFile(resolve(dist, 'full.html'), page(full)),
        writeFile(resolve(dist, 'lean.html'), page(lean)),
        writeFile(
          resolve(dist, 'nonce.html'),
          page(full, nonce, '<script>globalThis.__h20UnnoncedScriptRan=true</script>'),
        ),
        writeFile(
          resolve(dist, 'build.json'),
          JSON.stringify({ fullBytes: Buffer.byteLength(full), leanBytes: Buffer.byteLength(lean) }),
        ),
      ]);
      `,
      'utf8',
    );
    const build = spawnSync(process.execPath, [builder, origin, NONCE], {
      cwd: consumer,
      encoding: 'utf8',
    });
    if (build.error !== undefined) throw build.error;
    if (build.status !== 0) throw commandFailure('packed plain-HTML build failed', build);
    return { archive, origin, root, server };
  } catch (error) {
    if (server?.listening === true) await close(server);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function open(page: Page, target: string): Promise<Frame> {
  if (fixture === undefined) throw new Error('packed fixture is unavailable');
  await page.goto(`${fixture.origin}/admin.html?target=${encodeURIComponent(target)}`);
  const frame = await waitForPreviewFrame(page, target);
  await waitForStarted(frame);
  return frame;
}

test.describe('plain HTML from the exact package archive', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    fixture = await createFixture();
  });

  test.afterAll(async () => {
    if (fixture === undefined) return;
    const { root, server } = fixture;
    fixture = undefined;
    await close(server);
    await rm(root, { recursive: true, force: true });
  });

  test('installs without framework peers and generates distinct full and lean pages', async ({
    request,
  }) => {
    if (fixture === undefined) throw new Error('packed fixture is unavailable');
    const response = await request.get(`${fixture.origin}/build.json`);
    expect(response.ok()).toBe(true);
    const measurements = (await response.json()) as { fullBytes: number; leanBytes: number };
    expect(measurements.leanBytes).toBeLessThan(measurements.fullBytes);
    expect(fixture.archive.name).toBe('payload-live-preview');
    expect(fixture.archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test('patches an initially empty scalar and distinguishes full structural support from lean', async ({
    page,
  }) => {
    const full = await open(page, '/full.html');
    await post(page, {
      subtitle: 'filled without server rendering',
      tags: ['one', 'two', 'three'],
    });
    await expect(full.getByTestId('subtitle')).toHaveText('filled without server rendering');
    await expect(full.getByTestId('tags').locator('li')).toHaveCount(3);

    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    const lean = await open(page, '/lean.html');
    await post(page, { subtitle: 'lean scalar', tags: ['one', 'two', 'three'] });
    await expect(lean.getByTestId('subtitle')).toHaveText('lean scalar');
    await expect(lean.getByTestId('tags').locator('li')).toHaveCount(1);
    await expect.poll(() => messages.join('\n')).toContain('LP0104');
    expect(messages.join('\n')).toContain('structural arrays');
  });

  test('runs the nonce-bearing runtime while the browser blocks an unnonced script', async ({
    page,
  }) => {
    if (fixture === undefined) throw new Error('packed fixture is unavailable');
    const response = await page.request.get(`${fixture.origin}/nonce.html`);
    expect(response.headers()['content-security-policy']).toContain(`script-src 'nonce-${NONCE}'`);

    const frame = await open(page, '/nonce.html');
    await expect
      .poll(() => frame.evaluate(() => Reflect.has(globalThis, '__h20UnnoncedScriptRan')))
      .toBe(false);
    // CSP hides the serialized attribute; the DOM property retains the nonce
    // the browser used to authorize this script.
    expect(
      await frame.locator('script[nonce]').evaluate((script: HTMLScriptElement) => script.nonce),
    ).toBe(NONCE);
    await post(page, { subtitle: 'nonce runtime executed', tags: ['still', 'full'] });
    await expect(frame.getByTestId('subtitle')).toHaveText('nonce runtime executed');
    await expect(frame.getByTestId('tags').locator('li')).toHaveCount(2);
  });
});
