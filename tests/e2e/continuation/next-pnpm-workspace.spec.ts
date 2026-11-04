/**
 * `<LivePreviewNavigation />` from the retained archive, in a pnpm workspace where Node finds
 * another copy of `next` from the package. Every site, command and bundler must commit two client
 * navigations without an error. The control build hands the package that other copy, and the page
 * must then fail as a wrong `next` makes it fail, or a pass could come from the layout alone.
 */
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  prepareNextPnpmWorkspace,
  type NextPnpmWorkspace,
  type WorkspaceRun,
} from '../helpers/next-pnpm-workspace';

interface Observed {
  __livePreviewRouteRefresh?: unknown;
  navigations?: number;
}

let workspace: NextPnpmWorkspace | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browserName }) => {
  test.setTimeout(600_000);
  workspace = await prepareNextPnpmWorkspace(
    resolve('test-results/next-pnpm-workspace', browserName),
  );
});

test.afterAll(async () => {
  await workspace?.close();
});

/** Every page error and console error the page reports from now on. */
function errorsOf(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const navigations = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => (window as Observed).navigations);

/** Both bundlers of each major, built and in development, except Next.js 15's `next build --turbopack` (ADR 0031). */
const RUNS: readonly WorkspaceRun[] = [
  { site: 'next-15', command: 'build', bundler: 'webpack' },
  { site: 'next-15', command: 'dev', bundler: 'webpack' },
  { site: 'next-15', command: 'dev', bundler: 'turbopack' },
  { site: 'next-16', command: 'build', bundler: 'turbopack' },
  { site: 'next-16', command: 'build', bundler: 'webpack' },
  { site: 'next-16', command: 'dev', bundler: 'turbopack' },
  { site: 'next-16', command: 'dev', bundler: 'webpack' },
];

RUNS.forEach((run) => {
  test(`${run.site}: next ${run.command} with ${run.bundler}`, async ({ page }) => {
    const site = await workspace!.serve(run);
    try {
      const errors = errorsOf(page);
      await page.goto(`${site.origin}/`);
      // Hydrated once the component has lent the runtime the router's refresh; a click
      // before that is a full page load, which dispatches nothing.
      await page.waitForFunction(
        () => typeof (window as Observed).__livePreviewRouteRefresh === 'function',
      );
      await page.evaluate(() => {
        const observed = window as Observed;
        observed.navigations = 0;
        document.addEventListener('payload-live-preview:navigation', () => {
          observed.navigations = (observed.navigations ?? 0) + 1;
        });
      });
      await page.click('#go');
      await expect(page.locator('h1#two')).toBeVisible();
      await expect.poll(() => navigations(page)).toBe(1);
      await page.click('#back');
      await expect(page.locator('h1#one')).toBeVisible();
      await expect.poll(() => navigations(page)).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await site.close();
    }
  });
});

test('control: the copy Node finds from the package breaks the same page', async ({ page }) => {
  const site = await workspace!.serve(
    { site: 'next-16', command: 'build', bundler: 'webpack' },
    true,
  );
  try {
    const errors = errorsOf(page);
    await page.goto(`${site.origin}/`);
    await expect
      .poll(() => errors.join('\n'))
      .toContain('invariant expected app router to be mounted');
    expect(await page.evaluate(() => typeof (window as Observed).__livePreviewRouteRefresh)).toBe(
      'undefined',
    );
  } finally {
    await site.close();
  }
});
