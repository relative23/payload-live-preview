import type { Server } from 'node:http';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import {
  ADMIN_ORIGIN,
  ask,
  cachingProxy,
  closeServer,
  freePort,
  mockPayload,
  quickstartProject,
  startProjectServer,
  writeProjectFiles,
  writeQuickstart,
  type QuickstartProject,
} from '../helpers/quickstart';

/**
 * The README's Next.js quickstart, rebuilt word for word: a fresh project with
 * Next.js and the packed archive, the `app/layout.tsx` of the page, and one
 * `app/page.tsx`. It is built and started with `next start`, and Payload is a
 * mock that knows one editor. The layout cannot see the query string, so the
 * verdict alone decides: an editor gets the runtime on every page.
 */

let fixture: QuickstartProject | undefined;
let payload: { server: Server; asked: string[] } | undefined;
let stop: (() => Promise<void>) | undefined;
/** What the project's server printed, for the message of a failed status. */
let output: () => string = () => '';
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  fixture = await quickstartProject('next', 'nextjs-payload');
  const { project, environment } = fixture;
  expect(await writeQuickstart(project, 'Next.js (App Router)')).toEqual(['app/layout.tsx']);
  await writeProjectFiles(project, {
    'app/page.tsx':
      'export default function Page() {\n  return <h1 data-payload-field="title">Server title</h1>;\n}\n',
  });
  const next = resolve(project, 'node_modules/.bin/next');
  const build = run(next, ['build'], project, { ...environment, NEXT_TELEMETRY_DISABLED: '1' });
  if (build.status !== 0) throw new Error(`next build failed:\n${detailFor(build)}`);

  const mock = await mockPayload();
  payload = mock;
  origin = `http://127.0.0.1:${String(await freePort())}`;
  ({ stop, output } = await startProjectServer(
    project,
    next,
    ['start', '--hostname', '127.0.0.1', '--port', new URL(origin).port],
    {
      ...environment,
      NEXT_TELEMETRY_DISABLED: '1',
      SITE_ORIGIN: origin,
      PUBLIC_PAYLOAD_ADMIN_ORIGIN: ADMIN_ORIGIN,
      PAYLOAD_URL: mock.origin,
    },
    origin,
  ));
});

test.afterAll(async () => {
  await stop?.();
  await closeServer(payload?.server);
  if (fixture !== undefined) await rm(fixture.root, { recursive: true, force: true });
});

test('a visitor gets the public page, whatever the address says', async () => {
  const visitor = await ask(`${origin}/?preview=true`, false);
  expect(visitor.status, output()).toBe(200);
  expect(visitor.html).toContain('Server title');
  expect(visitor.html).not.toContain('__livePreview');
});

test('an editor gets the runtime in the head, and Payload was asked', async () => {
  const editor = await ask(`${origin}/?preview=true`, true);
  expect(editor.status, output()).toBe(200);
  expect(editor.html).toContain('Server title');
  expect(editor.html).toContain('__livePreview');
  expect(payload?.asked.some((line) => line.startsWith('GET /api/users/me'))).toBe(true);
});

test("a shared cache in front of the server does not hand the editor's preview to a visitor", async () => {
  const cache = await cachingProxy(origin);
  try {
    const editor = await ask(`${cache.origin}/?preview=true`, true);
    expect(editor.html).toContain('__livePreview');
    // Next.js answers a page that reads the request's headers with `no-store` itself.
    expect(editor.cacheControl).toContain('no-store');
    expect(cache.stored()).toEqual([]);
    const visitor = await ask(`${cache.origin}/?preview=true`, false);
    expect(visitor.html).toContain('Server title');
    expect(visitor.html).not.toContain('__livePreview');
    expect(cache.hits).toEqual([]);
  } finally {
    await closeServer(cache.server);
  }
});
