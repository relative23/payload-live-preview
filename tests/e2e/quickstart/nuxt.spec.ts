import type { Server } from 'node:http';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import {
  ADMIN_ORIGIN,
  ask,
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
 * The README's Nuxt quickstart, rebuilt word for word: a fresh project with
 * Nuxt and the packed archive, the `nuxt.config.ts` and the authorization
 * module of the page, and one `app/app.vue`. It is built and started as a
 * Node server, and Payload is a mock that knows one editor.
 */

let fixture: QuickstartProject | undefined;
let payload: { server: Server; asked: string[] } | undefined;
let stop: (() => Promise<void>) | undefined;
/** What the project's server printed, for the message of a failed status. */
let output: () => string = () => '';
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  fixture = await quickstartProject('nuxt', 'nuxt-payload');
  const { project, environment } = fixture;
  expect(await writeQuickstart(project, 'Nuxt')).toEqual([
    'nuxt.config.ts',
    'server/utils/live-preview-auth.ts',
  ]);
  await writeProjectFiles(project, {
    'app/app.vue': '<template>\n  <h1 data-payload-field="title">Server title</h1>\n</template>\n',
  });
  // `nuxt.config.ts` reads the admin origin when the project is built.
  const build = run(resolve(project, 'node_modules/.bin/nuxt'), ['build'], project, {
    ...environment,
    NUXT_TELEMETRY_DISABLED: '1',
    PUBLIC_PAYLOAD_ADMIN_ORIGIN: ADMIN_ORIGIN,
  });
  if (build.status !== 0) throw new Error(`nuxt build failed:\n${detailFor(build)}`);

  const mock = await mockPayload();
  payload = mock;
  origin = `http://127.0.0.1:${String(await freePort())}`;
  ({ stop, output } = await startProjectServer(
    project,
    process.execPath,
    ['.output/server/index.mjs'],
    {
      ...environment,
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: new URL(origin).port,
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

test('a visitor who asks for a preview gets the public page', async () => {
  const visitor = await ask(`${origin}/?preview=true`, false);
  expect(visitor.status, output()).toBe(200);
  expect(visitor.html).toContain('Server title');
  expect(visitor.html).not.toContain('__livePreview');
  expect(visitor.csp).not.toContain(ADMIN_ORIGIN);
});

test('an editor who asks for a preview gets the runtime and may be framed by the admin', async () => {
  const editor = await ask(`${origin}/?preview=true`, true);
  expect(editor.status, output()).toBe(200);
  expect(editor.html).toContain('__livePreview');
  expect(editor.csp).toContain(`frame-ancestors 'self' ${ADMIN_ORIGIN}`);
  expect(payload?.asked.some((line) => line.startsWith('GET /api/users/me'))).toBe(true);
});

test('without the preview parameter the editor gets the public page too', async () => {
  const plain = await ask(origin, true);
  expect(plain.html).toContain('Server title');
  expect(plain.html).not.toContain('__livePreview');
});
