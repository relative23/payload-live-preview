import type { Server } from 'node:http';
import { readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';
import {
  closeServer,
  quickstartProject,
  serveSite,
  writeProjectFiles,
  writeQuickstart,
  type QuickstartProject,
} from '../helpers/quickstart';

/**
 * The README's Astro quickstart, rebuilt word for word: a fresh project with
 * Astro and the packed archive, the `astro.config.mjs` of the page, and one
 * page of its own with one bound field. The site is built and served as
 * static files.
 */

let fixture: QuickstartProject | undefined;
let server: Server | undefined;
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(600_000);
  fixture = await quickstartProject('astro', 'astro-payload');
  const { project, environment } = fixture;
  expect(await writeQuickstart(project, 'Astro')).toEqual(['astro.config.mjs']);
  await writeProjectFiles(project, {
    'src/pages/index.astro':
      '---\n---\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Quickstart</title>\n  </head>\n' +
      '  <body>\n    <h1 data-payload-field="title" data-testid="title">Server title</h1>\n  </body>\n</html>\n',
  });
  ({ server, origin } = await serveSite(resolve(project, 'dist')));
  const build = run(resolve(project, 'node_modules/.bin/astro'), ['build'], project, {
    ...environment,
    PUBLIC_PAYLOAD_ADMIN_ORIGIN: origin,
    ASTRO_TELEMETRY_DISABLED: '1',
  });
  if (build.status !== 0) throw new Error(`astro build failed:\n${detailFor(build)}`);
});

test.afterAll(async () => {
  await closeServer(server);
  if (fixture !== undefined) await rm(fixture.root, { recursive: true, force: true });
});

test('every page carries a bootstrap, not the runtime', async () => {
  const page = resolve(fixture?.project ?? '', 'dist/index.html');
  expect(await readFile(page, 'utf8')).toContain('<script');
  // "A bootstrap of a few hundred bytes": the page with it stays far below the runtime's size.
  expect((await stat(page)).size).toBeLessThan(4_000);
});

test('a visitor gets the page and no runtime, and nothing fetches it', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto(origin);
  await expect(page.getByTestId('title')).toHaveText('Server title');
  expect(await page.evaluate(() => Reflect.has(globalThis, '__livePreview'))).toBe(false);
  expect(scripts).toEqual([]);
});

test('in the frame of the admin the runtime is fetched, starts and writes the field', async ({
  page,
}) => {
  await page.goto(`${origin}/admin`);
  const frame = await waitForPreviewFrame(page);
  await waitForStarted(frame);
  await post(page, { title: 'From the admin' });
  await expect(frame.getByTestId('title')).toHaveText('From the admin');
});
