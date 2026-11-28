import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { parseNpmPackReport } from '../../../scripts/package-artifact';
import { initializeConsumer, installStrictly } from '../../../scripts/package-smoke-consumer';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { quickstartFiles } from '../../../scripts/quickstart-blocks';
import { sanitizeNpmScriptEnvironment } from '../../../scripts/release-contracts';
import { acceptedRevisions, post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The README's plain HTML quickstart, rebuilt word for word: a fresh project
 * outside the repository installs the packed archive and nothing else, writes
 * the `build.ts` of the page, and runs it. What the replay adds is one line
 * that saves the page the snippet builds, and the admin that frames it.
 */

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let root: string | undefined;
let server: Server | undefined;
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  root = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-quickstart-html-'));
  const environment = sanitizeNpmScriptEnvironment(process.env);
  const pack = run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
    REPOSITORY_ROOT,
    environment,
  );
  if (pack.status !== 0) throw new Error(`npm pack failed:\n${detailFor(pack)}`);
  const tarball = resolve(root, parseNpmPackReport(pack.stdout).filename);
  const consumer = resolve(root, 'project');
  await initializeConsumer(consumer);
  const install = installStrictly(consumer, [tarball]);
  if (install.status !== 0) throw new Error(`the install failed:\n${detailFor(install)}`);

  const page = resolve(consumer, 'index.html');
  server = createServer((request, response) => {
    const framed = new URL(request.url ?? '/', 'http://localhost').pathname === '/index.html';
    void (
      framed
        ? readFile(page)
        : Promise.resolve(
            '<!doctype html><html><body><iframe data-testid="preview-frame" title="Live preview" ' +
              'src="/index.html"></iframe></body></html>',
          )
    ).then(
      (body) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body),
      () => response.writeHead(404).end('not found'),
    );
  });
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${String(address.port)}`;

  const files = quickstartFiles(
    await readFile(resolve(REPOSITORY_ROOT, 'README.md'), 'utf8'),
    'Plain HTML',
  );
  expect(files.map((file) => file.path)).toEqual(['build.ts']);
  await writeFile(
    resolve(consumer, 'build.ts'),
    `${files[0]?.content ?? ''}await (await import('node:fs/promises')).writeFile('index.html', html);\n`,
  );
  const build = run(process.execPath, ['build.ts'], consumer, {
    ...environment,
    PUBLIC_PAYLOAD_ADMIN_ORIGIN: origin,
  });
  if (build.status !== 0) throw new Error(`build.ts failed:\n${detailFor(build)}`);
});

test.afterAll(async () => {
  await new Promise<void>((done) => (server === undefined ? done() : server.close(() => done())));
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

test('the page the snippet builds carries the script in its head', async () => {
  const html = await readFile(resolve(root ?? '', 'project/index.html'), 'utf8');
  expect(
    html.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8"><script>'),
  ).toBe(true);
  expect(html).toContain(JSON.stringify(origin));
});

test('a visitor who opens the page gets no runtime', async ({ page }) => {
  await page.goto(`${origin}/index.html`);
  expect(await page.evaluate(() => Reflect.has(globalThis, '__livePreview'))).toBe(false);
});

test('in the frame of the admin the runtime starts and takes an update', async ({ page }) => {
  await page.goto(origin);
  const frame = await waitForPreviewFrame(page, '/index.html');
  await waitForStarted(frame);
  await post(page, { title: 'From the admin' });
  await expect.poll(() => acceptedRevisions(frame)).toBe(1);
});
