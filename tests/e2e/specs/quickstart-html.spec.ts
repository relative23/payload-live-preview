import type { Server } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { detailFor, run } from '../../../scripts/package-smoke-support';
import { acceptedRevisions, post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';
import {
  closeServer,
  quickstartProject,
  serveSite,
  writeQuickstart,
  type QuickstartProject,
} from '../helpers/quickstart';

/**
 * The README's plain HTML quickstart, rebuilt word for word: a fresh project
 * outside the repository installs the packed archive and nothing else, writes
 * the `build.ts` of the page, and runs it. What the replay adds is one line
 * that saves the page the snippet builds, and the admin that frames it.
 */

let fixture: QuickstartProject | undefined;
let server: Server | undefined;
let origin = '';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  fixture = await quickstartProject('html');
  const { project, environment } = fixture;
  ({ server, origin } = await serveSite(project));
  expect(
    await writeQuickstart(project, 'Plain HTML', {
      'build.ts': "await (await import('node:fs/promises')).writeFile('index.html', html);\n",
    }),
  ).toEqual(['build.ts']);
  const build = run(process.execPath, ['build.ts'], project, {
    ...environment,
    PUBLIC_PAYLOAD_ADMIN_ORIGIN: origin,
  });
  if (build.status !== 0) throw new Error(`build.ts failed:\n${detailFor(build)}`);
});

test.afterAll(async () => {
  await closeServer(server);
  if (fixture !== undefined) await rm(fixture.root, { recursive: true, force: true });
});

test('the page the snippet builds carries the script in its head', async () => {
  const html = await readFile(resolve(fixture?.project ?? '', 'index.html'), 'utf8');
  expect(
    html.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8"><script>'),
  ).toBe(true);
  expect(html).toContain(JSON.stringify(origin));
});

test('a visitor who opens the page gets no runtime', async ({ page }) => {
  await page.goto(origin);
  expect(await page.evaluate(() => Reflect.has(globalThis, '__livePreview'))).toBe(false);
});

test('in the frame of the admin the runtime starts and takes an update', async ({ page }) => {
  await page.goto(`${origin}/admin`);
  const frame = await waitForPreviewFrame(page);
  await waitForStarted(frame);
  await post(page, { title: 'From the admin' });
  await expect.poll(() => acceptedRevisions(frame)).toBe(1);
});
