import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * Custom elements that opt in with `data-payload-morph` (ADR 0008 §10) on the two
 * paths that morph server HTML into the page: a fragment render of its boundary
 * and a whole-route refresh (`examples/astro-hybrid`). The opted-in host keeps its
 * identity and shadow root while its light DOM follows the server; the same
 * element without the attribute is retained whole, so its text stays as it was.
 * Each test adds the two probes to the server markup through `page.route`.
 */

const APP = 'http://localhost:4177';
const OWNER = { globalSlug: 'home' };
const OPTED_IN = 'x-morph-probe';
const PLAIN = 'x-plain-probe';

const HERO_WORDS = /<p data-testid="hero-words">(\d+) words<\/p>/u;
const ROUTE_STAMP = /<p data-testid="route-stamp">(\d+)<\/p>/u;

function probes(text: string): string {
  return (
    `<${OPTED_IN} data-payload-morph><span>${text}</span></${OPTED_IN}>` +
    `<${PLAIN}><span>${text}</span></${PLAIN}>`
  );
}

/** Both probes follow the server value they sit beside, so a render changes their text. */
function withFragmentProbes(html: string): string {
  return html.replace(HERO_WORDS, (whole, count: string) => whole + probes(`${count} words`));
}

function withRouteProbes(html: string): string {
  return html.replace(ROUTE_STAMP, (whole, stamp: string) => whole + probes(`stamp ${stamp}`));
}

async function serveProbes(
  page: Page,
  rewrite: { document: (html: string) => string; fragment?: (html: string) => string },
): Promise<void> {
  await page.addInitScript(
    ([opted, plain]) => {
      for (const tag of [opted, plain]) {
        customElements.define(
          tag!,
          class extends HTMLElement {
            connections = 0;
            state = 0;
            connectedCallback(): void {
              this.connections += 1;
              if (this.shadowRoot === null) {
                this.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
              }
            }
          },
        );
      }
    },
    [OPTED_IN, PLAIN],
  );
  await page.route(/\/\?preview=true/u, async (intercepted) => {
    const response = await intercepted.fetch();
    if (!(response.headers()['content-type'] ?? '').includes('text/html')) {
      await intercepted.fulfill({ response });
      return;
    }
    await intercepted.fulfill({ response, body: rewrite.document(await response.text()) });
  });
  const { fragment } = rewrite;
  if (fragment === undefined) return;
  await page.route(`${APP}/payload/fragment`, async (intercepted) => {
    const response = await intercepted.fetch();
    const rendered = (await response.json()) as { html: string };
    await intercepted.fulfill({
      response,
      body: JSON.stringify({ ...rendered, html: fragment(rendered.html) }),
    });
  });
}

async function open(page: Page): Promise<Frame> {
  await page.goto(`${APP}/bench`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  return frame;
}

/** Gives each probe an identity mark and a state the server never sends. */
async function mark(frame: Frame): Promise<void> {
  await frame.evaluate(
    ([opted, plain]) => {
      for (const tag of [opted!, plain!]) {
        const host = document.querySelector<HTMLElement & { state: number }>(tag)!;
        host.state = 42;
        Object.assign(window, { [`__host:${tag}`]: host, [`__shadow:${tag}`]: host.shadowRoot });
      }
    },
    [OPTED_IN, PLAIN],
  );
}

interface Observed {
  sameHost: boolean;
  sameShadow: boolean;
  connections: number;
  state: number;
  text: string | null | undefined;
}

async function observe(frame: Frame, tag: string): Promise<Observed> {
  return frame.evaluate((name) => {
    const host = document.querySelector<HTMLElement & { state: number; connections: number }>(
      name,
    )!;
    return {
      sameHost: host === Reflect.get(window, `__host:${name}`),
      sameShadow: host.shadowRoot === Reflect.get(window, `__shadow:${name}`),
      connections: host.connections,
      state: host.state,
      text: host.querySelector('span')?.textContent,
    };
  }, tag);
}

test.describe('hybrid custom-element morph — an opted-in host keeps its identity', () => {
  test('a fragment render updates the light DOM of an opted-in element inside the boundary', async ({
    page,
  }) => {
    await serveProbes(page, { document: withFragmentProbes, fragment: withFragmentProbes });
    const frame = await open(page);
    const before = await frame.locator(`${PLAIN} span`).textContent();
    await mark(frame);

    await post(page, { title: 'Probed', subtitle: 'Server only', body: 'one two' }, OWNER);
    await expect(frame.getByTestId('hero-words')).toHaveText('2 words');
    await expect(frame.locator(`${OPTED_IN} span`)).toHaveText('2 words');

    expect(await observe(frame, OPTED_IN)).toEqual({
      sameHost: true,
      sameShadow: true,
      connections: 1,
      state: 42,
      text: '2 words',
    });
    // Without the attribute the host is retained whole: same element, same text as before.
    expect(await observe(frame, PLAIN)).toEqual({
      sameHost: true,
      sameShadow: true,
      connections: 1,
      state: 42,
      text: before,
    });
    expect(before).not.toBe('2 words');
  });

  test('a route refresh updates the light DOM of an opted-in element outside any boundary', async ({
    page,
  }) => {
    await serveProbes(page, { document: withRouteProbes });
    const frame = await open(page);
    const before = await frame.locator(`${PLAIN} span`).textContent();
    await mark(frame);

    await post(page, { title: 'Route refreshed' }, OWNER);
    await expect.poll(async () => frame.evaluate(() => document.title)).toBe('Route refreshed');
    await expect(frame.locator(`${OPTED_IN} span`)).not.toHaveText(before ?? '');

    const stamp = await frame.getByTestId('route-stamp').textContent();
    expect(await observe(frame, OPTED_IN)).toEqual({
      sameHost: true,
      sameShadow: true,
      connections: 1,
      state: 42,
      text: `stamp ${stamp ?? ''}`,
    });
    expect(await observe(frame, PLAIN)).toEqual({
      sameHost: true,
      sameShadow: true,
      connections: 1,
      state: 42,
      text: before,
    });
  });
});
