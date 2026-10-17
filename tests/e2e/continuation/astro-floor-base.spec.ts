/**
 * The exact Astro 4 peer floor is a static production consumer of one archive, built in
 * both delivery modes. The parent is a mock that posts the observed Payload message shape,
 * so this proves framework delivery and DOM behavior at the floor, not a real admin.
 * Two control builds drop one capability each; the same visible-behavior assertions must
 * then fail, or a pass could come from the static page alone.
 */
import { resolve } from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  prepareAstroFloorBase,
  type AstroFloorBase,
  type AstroFloorSite,
  type FloorControl,
  type FloorDelivery,
} from '../helpers/astro-floor-base';

let floor: AstroFloorBase | undefined;

test.beforeAll(async ({ browserName }, info) => {
  test.setTimeout(240_000);
  floor = await prepareAstroFloorBase(
    resolve(
      'test-results/astro-floor-base',
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      browserName,
      'worker-' + String(info.workerIndex),
    ),
  );
});
test.afterAll(async () => {
  await floor?.close();
});

function lexical(text: string) {
  return {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
    },
  };
}

async function send(page: Page, fields: Record<string, unknown>, id = 7): Promise<void> {
  await page.evaluate(
    ({ fields, id }) => {
      document.querySelector<HTMLIFrameElement>('#preview')!.contentWindow!.postMessage(
        {
          type: 'payload-live-preview',
          collectionSlug: 'pages',
          locale: 'en',
          data: { id, ...fields },
        },
        location.origin,
      );
    },
    { fields, id },
  );
}

async function open(page: Page): Promise<FrameLocator> {
  await page.goto('/admin.html');
  const frame = page.frameLocator('#preview');
  await expect(frame.locator('[data-payload-field="title"]')).toBeVisible();
  return frame;
}

/** Runs in the page under test, so it may use only what that page itself offers. */
function runtimeHasStarted(): boolean {
  const runtime = (window as Window & { __livePreview?: { inspect: () => { started: unknown } } })
    .__livePreview;
  return typeof runtime?.inspect === 'function' && runtime.inspect().started === true;
}

// A poll reads a frame that has no context yet, or lost it to a navigation, as "not yet".
const runtimeStarted = (frame: FrameLocator): Promise<boolean> =>
  frame
    .locator('body')
    .evaluate(runtimeHasStarted, undefined, { timeout: 2_000 })
    .catch(() => false);

const textOf = (frame: FrameLocator, selector: string): Promise<string | null> =>
  frame
    .locator(selector)
    .textContent({ timeout: 1_000 })
    .catch(() => null);

/** The visible behavior of a trusted title update; the control builds run the same code. */
async function titleUpdateArrives(page: Page, frame: FrameLocator, timeout: number): Promise<void> {
  const text = '<img src=x onerror="window.floorInjected=true"> Unsaved title';
  await expect
    .poll(
      async () => {
        await send(page, { title: text }).catch(() => undefined);
        return textOf(frame, '[data-payload-field="title"]');
      },
      { timeout },
    )
    .toBe(text);
  expect(await frame.locator('[data-payload-field="title"] img').count()).toBe(0);
  expect(
    await frame
      .locator('body')
      .evaluate(() => (window as Window & { floorInjected?: unknown }).floorInjected),
  ).toBeUndefined();
}

const runtimeStartsInFrame = (frame: FrameLocator, timeout: number): Promise<void> =>
  expect.poll(() => runtimeStarted(frame), { timeout }).toBe(true);

/** A control passes only when a visible-behavior assertion failed, never on a setup error. */
async function assertionFails(assertion: Promise<unknown>): Promise<void> {
  const failure = await assertion.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(failure, 'the assertion passed on a build without the capability').toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('expect(');
}

function describeDelivery(delivery: FloorDelivery): void {
  test.describe(`Astro 4.0.0 floor, ${delivery} delivery`, () => {
    let site: AstroFloorSite | undefined;
    test.beforeAll(async () => {
      test.setTimeout(240_000);
      site = await floor!.serve(delivery);
    });
    test.afterAll(async () => {
      await site?.close();
    });

    test('a public page renders both shipped Astro components and stays inactive', async ({
      page,
    }) => {
      const scripts: string[] = [];
      page.on('request', (request) => {
        if (request.resourceType() === 'script') scripts.push(request.url());
      });
      await page.goto('/');
      await expect(page.locator('[data-payload-field="body"] p')).toHaveText('Saved rich text');
      await expect(page.locator('[data-testid="subtitle"]')).toHaveAttribute('hidden', '');
      expect(await page.evaluate(runtimeHasStarted)).toBe(false);
      expect(scripts.filter((url) => url.includes('payload-live-preview'))).toEqual([]);
    });

    test('the injected runtime starts in the preview iframe', async ({ page }) => {
      const frame = await open(page);
      await runtimeStartsInFrame(frame, 5_000);
    });

    test('a trusted parent title update reaches the fixed document owner as plain text', async ({
      page,
    }) => {
      const frame = await open(page);
      await titleUpdateArrives(page, frame, 10_000);
    });

    test('the shipped empty boundary fills and empties and Lexical updates match the page', async ({
      page,
    }) => {
      const frame = await open(page);
      await expect
        .poll(async () => {
          await send(page, {
            title: 'Bound',
            subtitle: 'Unsaved subtitle',
            body: lexical('Unsaved rich text'),
          }).catch(() => undefined);
          return textOf(frame, '[data-payload-field="body"]');
        })
        .toBe('Unsaved rich text');
      await expect(frame.locator('[data-testid="subtitle"]')).toBeVisible();
      await expect(frame.locator('[data-testid="subtitle"]')).toHaveText('Unsaved subtitle');
      await send(page, { title: 'Bound', subtitle: '', body: lexical('Unsaved rich text') });
      await expect(frame.locator('[data-testid="subtitle"]')).toHaveAttribute('hidden', '');
    });

    test('the scoped page ignores another document after accepting its own', async ({ page }) => {
      const frame = await open(page);
      await expect
        .poll(async () => {
          await send(page, { title: 'Owner accepted' }).catch(() => undefined);
          return textOf(frame, '[data-payload-field="title"]');
        })
        .toBe('Owner accepted');
      await send(page, { title: 'Other document' }, 8);
      await page.waitForTimeout(500);
      await expect(frame.locator('[data-payload-field="title"]')).toHaveText('Owner accepted');
    });
  });
}

describeDelivery('loader');
describeDelivery('inline');

type Assertion = (page: Page, frame: FrameLocator) => Promise<void>;

function describeControl(
  control: Exclude<FloorControl, 'none'>,
  title: string,
  assertions: readonly Assertion[],
): void {
  test.describe(`Astro 4.0.0 floor, control build: ${control}`, () => {
    let site: AstroFloorSite | undefined;
    test.beforeAll(async () => {
      test.setTimeout(240_000);
      site = await floor!.serve('loader', control);
    });
    test.afterAll(async () => {
      await site?.close();
    });

    test(title, async ({ page }) => {
      const frame = await open(page);
      for (const assertion of assertions) await assertionFails(assertion(page, frame));
      await expect(frame.locator('[data-payload-field="title"]')).toHaveText('Saved title');
    });
  });
}

describeControl(
  'no-integration',
  'without the integration the runtime never starts and no update reaches the page',
  [
    (_page, frame) => runtimeStartsInFrame(frame, 3_000),
    (page, frame) => titleUpdateArrives(page, frame, 3_000),
  ],
);
describeControl('wrong-origin', 'an origin the integration does not allow gets no update through', [
  (page, frame) => titleUpdateArrives(page, frame, 3_000),
]);
