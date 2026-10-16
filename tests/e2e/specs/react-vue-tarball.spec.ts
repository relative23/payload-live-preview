/**
 * React and Vue are separate products. This isolated archive consumer verifies
 * their types, SSR, native hydration and lifecycle in a production build.
 */

import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
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
  bootstrapDeclaredPeersStrictly,
  initializeConsumer,
  installStrictly,
  probeLocalDependency,
} from '../../../scripts/package-smoke-consumer';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { sanitizeNpmScriptEnvironment } from '../../../scripts/release-contracts';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REVIEWED_DEPENDENCIES = {
  '@types/react': '19.2.18',
  '@types/react-dom': '19.2.7',
  react: '19.2.8',
  'react-dom': '19.2.8',
  typescript: '5.9.3',
  vue: '3.5.42',
} as const;
const TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

interface PackedFrameworkFixture {
  readonly archive: PackageArchiveEvidence;
  readonly origin: string;
  readonly root: string;
  readonly server: Server;
  readonly ssr: { readonly react: string; readonly vue: string };
}

interface RequestState {
  readonly counts: Map<string, number>;
}

let fixture: PackedFrameworkFixture | undefined;

function failure(label: string, result: { readonly stdout: string; readonly stderr: string }) {
  return new Error(`${label}:\n${detailFor(result)}`);
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
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

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
}

function fixtureServer(dist: string, state: RequestState): Server {
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (request.method === 'GET' && url.pathname === '/requests') {
          response
            .writeHead(200, { 'content-type': TYPES['.json'] })
            .end(JSON.stringify(Object.fromEntries(state.counts)));
          return;
        }
        if (request.method === 'POST' && url.pathname.startsWith('/api/pages/')) {
          const surface = request.headers['x-h19-surface'] ?? 'unknown';
          state.counts.set(String(surface), (state.counts.get(String(surface)) ?? 0) + 1);
          const parsed = JSON.parse(await bodyOf(request)) as {
            data?: Record<string, unknown>;
          };
          const data = parsed.data ?? {};
          if (data['title'] === 'expired') {
            response.writeHead(401).end('expired');
            return;
          }
          if (data['title'] === 'slow old') {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
          }
          const result =
            data['title'] === 'wrong identity'
              ? { id: 'other-document', title: 'Wrong document' }
              : { ...data, title: `${String(data['title'])} merged` };
          response.writeHead(200, { 'content-type': TYPES['.json'] }).end(JSON.stringify(result));
          return;
        }
        const pathname = url.pathname === '/' ? '/admin.html' : decodeURIComponent(url.pathname);
        const file = resolve(dist, `.${pathname}`);
        const fromDist = relative(dist, file);
        if (isAbsolute(fromDist) || fromDist === '..' || fromDist.startsWith(`..${sep}`)) {
          response.writeHead(403).end('forbidden');
          return;
        }
        const body = await readFile(file);
        response
          .writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
          .end(body);
      } catch {
        response.writeHead(404).end('not found');
      }
    })();
  });
}

async function writeConsumer(consumer: string): Promise<void> {
  await Promise.all([
    writeFile(
      resolve(consumer, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            lib: ['DOM', 'ES2022'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            strict: true,
            target: 'ES2022',
          },
          include: ['type-contract.ts'],
        },
        null,
        2,
      ),
      'utf8',
    ),
    writeFile(
      resolve(consumer, 'type-contract.ts'),
      `
      import { useLivePreviewDocument as useReact } from 'payload-live-preview/react';
      import { useLivePreviewDocument as useVue } from 'payload-live-preview/vue';
      interface Page extends Record<string, unknown> { id: string; title: string }
      declare const page: Page;
      export function reactContract() {
        const snapshot = useReact<Page>({ serverURL: 'https://cms.example', initialData: page });
        const title: string = snapshot.data.title;
        const status: 'idle' | 'live' | 'unavailable' = snapshot.status;
        return { title, status };
      }
      export function vueContract() {
        const snapshot = useVue<Page>({ serverURL: 'https://cms.example', initialData: page });
        const title: string = snapshot.data.value.title;
        const status: 'idle' | 'live' | 'unavailable' = snapshot.status.value;
        return { title, status };
      }
      `,
      'utf8',
    ),
    writeFile(
      resolve(consumer, 'ssr.mjs'),
      `
      import React from 'react';
      import { renderToString } from 'react-dom/server';
      import { createSSRApp, h } from 'vue';
      import { renderToString as renderVue } from '@vue/server-renderer';
      import { useLivePreviewDocument as useReact } from 'payload-live-preview/react';
      import { useLivePreviewDocument as useVue } from 'payload-live-preview/vue';
      const initialData = { id: '1', title: 'Server title' };
      function ReactPreview() {
        const { data, status } = useReact({ serverURL: 'https://cms.example', initialData });
        return React.createElement(React.Fragment, null,
          React.createElement('button', { 'data-testid': 'new-key' }, 'new key'),
          React.createElement('article', null,
            React.createElement('h1', { 'data-testid': 'title' }, data.title),
            React.createElement('p', { 'data-testid': 'status' }, status),
            React.createElement('button', { 'data-testid': 'counter' }, '0'),
            React.createElement('input', { 'data-testid': 'input', defaultValue: 'server input' })));
      }
      const VuePreview = {
        setup() {
          const { data, status } = useVue({ serverURL: 'https://cms.example', initialData });
          return () => h('div', null, [
            h('button', { 'data-testid': 'new-key' }, 'new key'),
            h('article', null, [
              h('h1', { 'data-testid': 'title' }, data.value.title),
              h('p', { 'data-testid': 'status' }, status.value),
              h('button', { 'data-testid': 'counter' }, '0'),
              h('input', { 'data-testid': 'input', placeholder: 'server input' }),
            ]),
          ]);
        },
      };
      process.stdout.write(JSON.stringify({
        react: renderToString(React.createElement(ReactPreview)),
        vue: await renderVue(createSSRApp(VuePreview)),
      }));
      `,
      'utf8',
    ),
    writeFile(
      resolve(consumer, 'react-client.jsx'),
      `
      import React, { StrictMode, useState } from 'react';
      import { hydrateRoot } from 'react-dom/client';
      import { useLivePreviewDocument } from 'payload-live-preview/react';
      const initialData = { id: '1', title: 'Server title' };
      const nextData = { id: '2', title: 'Page B' };
      function Stateful({ data, status }) {
        const [count, setCount] = useState(0);
        return React.createElement('article', null,
          React.createElement('h1', { 'data-testid': 'title' }, data.title),
          React.createElement('p', { 'data-testid': 'status' }, status),
          React.createElement('button', { 'data-testid': 'counter', onClick: () => setCount(count + 1) }, String(count)),
          React.createElement('input', { 'data-testid': 'input', defaultValue: 'server input' }));
      }
      function Preview({ documentKey, document }) {
        const snapshot = useLivePreviewDocument({
          serverURL: location.origin,
          allowedOrigins: [location.origin],
          initialData: document,
          fetchFn: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-h19-surface': 'react' } }),
        });
        return React.createElement(Stateful, { key: documentKey, data: snapshot.data, status: snapshot.status });
      }
      function App() {
        const [documentKey, setDocumentKey] = useState('one');
        return React.createElement(React.Fragment, null,
          React.createElement('button', { 'data-testid': 'new-key', onClick: () => setDocumentKey('two') }, 'new key'),
          React.createElement(Preview, {
            key: documentKey,
            documentKey,
            document: documentKey === 'one' ? initialData : nextData,
          }));
      }
      const hydrationErrors = [];
      const root = hydrateRoot(
        document.querySelector('#app'),
        React.createElement(StrictMode, null, React.createElement(App)),
        { onRecoverableError: (error) => hydrationErrors.push(String(error)) },
      );
      window.__h19 = { ready: true, hydrationErrors, unmount: () => root.unmount() };
      `,
      'utf8',
    ),
    writeFile(
      resolve(consumer, 'vue-client.js'),
      `
      import { createSSRApp, defineComponent, h, ref } from 'vue';
      import { useLivePreviewDocument } from 'payload-live-preview/vue';
      const initialData = { id: '1', title: 'Server title' };
      const nextData = { id: '2', title: 'Page B' };
      const Stateful = defineComponent({
        props: ['data', 'status'],
        setup(props) {
          const count = ref(0);
          return () => h('article', null, [
            h('h1', { 'data-testid': 'title' }, props.data.title),
            h('p', { 'data-testid': 'status' }, props.status),
            h('button', { 'data-testid': 'counter', onClick: () => count.value += 1 }, String(count.value)),
            h('input', { 'data-testid': 'input', placeholder: 'server input' }),
          ]);
        },
      });
      const Preview = defineComponent({
        props: ['documentKey', 'document'],
        setup(props) {
          const snapshot = useLivePreviewDocument({
            serverURL: location.origin,
            allowedOrigins: [location.origin],
            initialData: props.document,
            fetchFn: (url, init) => fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'x-h19-surface': 'vue' } }),
          });
          return () => h(Stateful, { key: props.documentKey, data: snapshot.data.value, status: snapshot.status.value });
        },
      });
      const App = defineComponent({
        setup() {
          const documentKey = ref('one');
          return () => h('div', null, [
            h('button', { 'data-testid': 'new-key', onClick: () => documentKey.value = 'two' }, 'new key'),
            h(Preview, {
              key: documentKey.value,
              documentKey: documentKey.value,
              document: documentKey.value === 'one' ? initialData : nextData,
            }),
          ]);
        },
      });
      const app = createSSRApp(App);
      const hydrationErrors = [];
      app.config.warnHandler = (message) => hydrationErrors.push(message);
      app.config.errorHandler = (error) => hydrationErrors.push(String(error));
      app.mount(document.querySelector('#app'));
      window.__h19 = { ready: true, hydrationErrors, unmount: () => app.unmount() };
      `,
      'utf8',
    ),
  ]);
}

async function createFixture(): Promise<PackedFrameworkFixture> {
  const root = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-react-vue-'));
  let server: Server | undefined;
  try {
    const pack = run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      REPOSITORY_ROOT,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (pack.status !== 0) throw failure('npm pack failed', pack);
    const report = parseNpmPackReport(pack.stdout);
    const tarball = resolve(root, report.filename);
    const archive = await createPackageArchiveEvidence(tarball, report);

    const consumer = resolve(root, 'consumer');
    await initializeConsumer(consumer, REVIEWED_DEPENDENCIES);
    const peers = bootstrapDeclaredPeersStrictly(consumer);
    if (peers.status !== 0) throw failure('reviewed peer install failed', peers);
    const install = installStrictly(consumer, [tarball]);
    if (install.status !== 0) throw failure('isolated tarball install failed', install);
    for (const dependency of ['payload-live-preview', 'react', 'react-dom', 'typescript', 'vue']) {
      const probe = probeLocalDependency(consumer, dependency);
      if (probe.status !== 0) throw failure(`${dependency} escaped the consumer`, probe);
    }
    for (const dependency of ['@types/react', '@types/react-dom']) {
      const manifest = await realpath(
        resolve(consumer, 'node_modules', dependency, 'package.json'),
      );
      if (!manifest.startsWith(`${await realpath(consumer)}${sep}`)) {
        throw new Error(`${dependency} escaped the isolated consumer`);
      }
    }
    const installedPackage = resolve(consumer, 'node_modules/payload-live-preview');
    if ((await lstat(installedPackage)).isSymbolicLink()) {
      throw new Error('packed package was installed as a symbolic link');
    }
    if (!(await realpath(installedPackage)).startsWith(`${await realpath(consumer)}${sep}`)) {
      throw new Error('packed package escaped the isolated consumer');
    }

    await writeConsumer(consumer);
    const typecheck = run(
      resolve(consumer, 'node_modules/.bin/tsc'),
      ['--pretty', 'false'],
      consumer,
    );
    if (typecheck.status !== 0) throw failure('packed hook typecheck failed', typecheck);
    const ssrRun = spawnSync(process.execPath, ['ssr.mjs'], { cwd: consumer, encoding: 'utf8' });
    if (ssrRun.error !== undefined) throw ssrRun.error;
    if (ssrRun.status !== 0) throw failure('packed hook SSR failed', ssrRun);
    const ssr = JSON.parse(ssrRun.stdout) as { react: string; vue: string };
    await writeFile(
      resolve(consumer, 'admin.html'),
      '<!doctype html><iframe data-testid="preview-frame" title="Preview"></iframe><script>document.querySelector("iframe").src=new URLSearchParams(location.search).get("target")||"/react.html";</script>',
      'utf8',
    );
    const dist = resolve(consumer, 'dist');
    // The compiler belongs to the harness; resolution starts at these consumer
    // entries, whose package imports were verified local above.
    const build = run(
      resolve(REPOSITORY_ROOT, 'node_modules/.bin/esbuild'),
      [
        resolve(consumer, 'react-client.jsx'),
        resolve(consumer, 'vue-client.js'),
        '--bundle',
        '--minify',
        '--format=esm',
        '--splitting',
        `--outdir=${resolve(dist, 'assets')}`,
      ],
      consumer,
    );
    if (build.status !== 0) throw failure('packed hook production build failed', build);
    await Promise.all([
      writeFile(
        resolve(dist, 'react.html'),
        `<!doctype html><div id="app">${ssr.react}</div><script type="module" src="/assets/react-client.js"></script>`,
        'utf8',
      ),
      writeFile(
        resolve(dist, 'vue.html'),
        `<!doctype html><div id="app">${ssr.vue}</div><script type="module" src="/assets/vue-client.js"></script>`,
        'utf8',
      ),
      writeFile(resolve(dist, 'admin.html'), await readFile(resolve(consumer, 'admin.html'))),
    ]);

    const state: RequestState = { counts: new Map() };
    server = fixtureServer(dist, state);
    const port = await listen(server);
    return {
      archive,
      origin: `http://127.0.0.1:${String(port)}`,
      root,
      server,
      ssr,
    };
  } catch (error) {
    if (server?.listening === true) await close(server);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function open(page: Page, surface: 'react' | 'vue'): Promise<Frame> {
  if (fixture === undefined) throw new Error('packed fixture is unavailable');
  await page.goto(`${fixture.origin}/admin.html?target=/${surface}.html`);
  const targetPath = `/${surface}.html`;
  await expect
    .poll(async () => {
      const candidate = page
        .frames()
        .find(
          (current) =>
            current !== page.mainFrame() && new URL(current.url()).pathname === targetPath,
        );
      if (candidate === undefined) return false;
      try {
        return await candidate.evaluate(() => Boolean(window.__h19?.ready));
      } catch {
        // WebKit may expose the initial about:blank frame while its target
        // document is committing. Reacquire it on the next poll.
        return false;
      }
    })
    .toBe(true);
  const frame = page
    .frames()
    .find(
      (candidate) =>
        candidate !== page.mainFrame() && new URL(candidate.url()).pathname === targetPath,
    );
  if (frame === undefined) throw new Error(`${surface} preview frame is unavailable`);
  expect(await frame.evaluate(() => window.__h19?.hydrationErrors ?? [])).toEqual([]);
  return frame;
}

async function postUpdate(
  page: Page,
  data: Record<string, unknown>,
  mode: 'valid' | 'wrong-origin' | 'wrong-source' = 'valid',
): Promise<void> {
  await page.evaluate(
    ({ payload, mode }) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (frame?.contentWindow == null) throw new Error('preview frame is unavailable');
      const message = { type: 'payload-live-preview', collectionSlug: 'pages', data: payload };
      if (mode === 'valid') frame.contentWindow.postMessage(message, location.origin);
      else {
        frame.contentWindow.dispatchEvent(
          new MessageEvent('message', {
            data: message,
            origin: mode === 'wrong-origin' ? 'https://evil.example' : location.origin,
            source: mode === 'wrong-source' ? frame.contentWindow : window,
          }),
        );
      }
    },
    { payload: data, mode },
  );
}

async function requestCount(page: Page, surface: string): Promise<number> {
  if (fixture === undefined) throw new Error('packed fixture is unavailable');
  const response = await page.request.get(`${fixture.origin}/requests`);
  const counts = (await response.json()) as Record<string, number>;
  return counts[surface] ?? 0;
}

async function verifyHydrationAndState(page: Page, surface: 'react' | 'vue'): Promise<void> {
  const frame = await open(page, surface);
  const before = await requestCount(page, surface);
  await frame.getByTestId('counter').click();
  await frame.getByTestId('input').fill('visitor text');

  await postUpdate(page, { id: '1', title: 'first live' });
  await expect(frame.getByTestId('title')).toHaveText('first live merged');
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect(frame.getByTestId('counter')).toHaveText('1');
  await expect(frame.getByTestId('input')).toHaveValue('visitor text');
  await expect.poll(() => requestCount(page, surface)).toBe(before + 1);

  await frame.getByTestId('new-key').click();
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await expect(frame.getByTestId('title')).toHaveText('Page B');
  await expect(frame.getByTestId('status')).toHaveText('idle');
}

async function verifyIdentityFailureAndCleanup(
  page: Page,
  surface: 'react' | 'vue',
): Promise<void> {
  const frame = await open(page, surface);
  const before = await requestCount(page, surface);
  await postUpdate(page, { id: '1', title: 'wrong origin' }, 'wrong-origin');
  await postUpdate(page, { id: '1', title: 'wrong source' }, 'wrong-source');
  await expect.poll(() => requestCount(page, surface)).toBe(before);

  await postUpdate(page, { id: '1', title: 'slow old' });
  await postUpdate(page, { id: '1', title: 'latest' });
  await expect(frame.getByTestId('title')).toHaveText('latest merged');
  await expect(frame.getByTestId('status')).toHaveText('live');

  for (const title of ['expired', 'wrong identity']) {
    await postUpdate(page, { id: '1', title: `before ${title}` });
    await expect(frame.getByTestId('title')).toHaveText(`before ${title} merged`);
    await expect(frame.getByTestId('status')).toHaveText('live');
    await postUpdate(page, { id: '1', title });
    await expect(frame.getByTestId('status')).toHaveText('unavailable');
    await expect(frame.getByTestId('title')).toHaveText(`before ${title} merged`);
  }
  await postUpdate(page, { id: '1', title: 'recovered' });
  await expect(frame.getByTestId('title')).toHaveText('recovered merged');
  await expect(frame.getByTestId('status')).toHaveText('live');
  const mountedCount = await requestCount(page, surface);

  await frame.evaluate(() => window.__h19?.unmount());
  await postUpdate(page, { id: '1', title: 'after unmount' });
  await expect.poll(() => requestCount(page, surface)).toBe(mountedCount);
}

test.describe('React and Vue from the exact package archive', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

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

  test('type-checks, server-renders and production-builds both public entries', async () => {
    if (fixture === undefined) throw new Error('packed fixture is unavailable');
    expect(fixture.archive.name).toBe('payload-live-preview');
    expect(fixture.archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(fixture.ssr.react).toContain('Server title');
    expect(fixture.ssr.vue).toContain('Server title');
    await test.info().attach('package-archive.json', {
      body: JSON.stringify(fixture.archive),
      contentType: 'application/json',
    });
    await test.info().attach('package.tgz', {
      path: resolve(fixture.root, fixture.archive.filename),
      contentType: 'application/gzip',
    });
  });

  test('React hydrates, keeps same-key state and resets state for a new key', async ({ page }) => {
    await verifyHydrationAndState(page, 'react');
  });

  test('React filters sender identity, keeps last-good data and cleans up', async ({ page }) => {
    await verifyIdentityFailureAndCleanup(page, 'react');
  });

  test('Vue hydrates, keeps same-key state and resets state for a new key', async ({ page }) => {
    await verifyHydrationAndState(page, 'vue');
  });

  test('Vue filters sender identity, keeps last-good data and cleans up', async ({ page }) => {
    await verifyIdentityFailureAndCleanup(page, 'vue');
  });
});

declare global {
  interface Window {
    __h19?: {
      readonly hydrationErrors: readonly string[];
      readonly ready: boolean;
      unmount: () => void;
    };
  }
}
