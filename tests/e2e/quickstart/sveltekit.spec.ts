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
 * The README's SvelteKit quickstart, rebuilt word for word: a fresh project
 * with SvelteKit and the packed archive, the `src/env.ts` and the
 * `src/hooks.server.ts` of the page, and the files every SvelteKit project has. It is built and started
 * as a Node server, and Payload is a mock that knows one editor.
 */

let fixture: QuickstartProject | undefined;
let payload: { server: Server; asked: string[] } | undefined;
let stop: (() => Promise<void>) | undefined;
/** What the project's server printed, for the message of a failed status. */
let output: () => string = () => '';
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  fixture = await quickstartProject('sveltekit', 'sveltekit-payload');
  const { project, environment } = fixture;
  expect(await writeQuickstart(project, 'SvelteKit')).toEqual([
    'src/env.ts',
    'src/hooks.server.ts',
  ]);
  await writeProjectFiles(project, {
    'vite.config.ts':
      "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\n" +
      "import { defineConfig } from 'vite';\n\nexport default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });\n",
    'src/app.html':
      '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    %sveltekit.head%\n  </head>\n' +
      '  <body>\n    <div style="display: contents">%sveltekit.body%</div>\n  </body>\n</html>\n',
    'src/routes/+page.svelte': '<h1 data-payload-field="title">Server title</h1>\n',
  });
  const build = run(resolve(project, 'node_modules/.bin/vite'), ['build'], project, environment);
  if (build.status !== 0) throw new Error(`vite build failed:\n${detailFor(build)}`);

  const mock = await mockPayload();
  payload = mock;
  origin = `http://127.0.0.1:${String(await freePort())}`;
  ({ stop, output } = await startProjectServer(
    project,
    process.execPath,
    ['build'],
    {
      ...environment,
      HOST: '127.0.0.1',
      PORT: new URL(origin).port,
      ORIGIN: origin,
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
