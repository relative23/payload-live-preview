import { expect, test, type APIRequestContext, type Frame, type Page } from '@playwright/test';
import { post, started, waitForPreviewFrame } from '../helpers/preview';
import {
  compareFidelity,
  regionOf,
  reportDifferences,
  signaturesOf,
  type Difference,
} from '../helpers/fidelity';
import {
  KNOWN_DIVERGENCES,
  SSR_FRAGMENT_RENDER,
  SSR_REFUSED_RENDER,
  STATIC_BASELINE,
  STATIC_FORCED_RENDER,
  TASKS_THAT_REMOVE_EXCEPTIONS,
  type FidelityCase,
} from '../../fixtures/fidelity-corpus';

/**
 * The fidelity oracle: is the patched page still the page the server would
 * send?
 *
 * Everything else in this suite asserts that an edit arrives. This spec asserts
 * the harder thing — that nothing else moved. It edits a document, asks the
 * fixture's own server to render the same state, normalises both, and treats
 * every remaining difference as a finding that names the field, the element and
 * the two values. Differences that exist today are written down in
 * `tests/fixtures/fidelity-corpus.ts` with the work item that removes them, so
 * the gate is green on today's behaviour and cannot stay green once that
 * behaviour changes in either direction.
 */

const STATIC_APP = 'http://localhost:4173';
const SSR_APP = 'http://localhost:4177';
const OWNER = { globalSlug: 'home' };

interface Api {
  inspect: () => {
    started: boolean;
    revisions: { completed: number };
    fragments: { rendered: number; failed: number };
  };
}

function inspect(frame: Frame): Promise<ReturnType<Api['inspect']>> {
  return frame.evaluate(() =>
    (window as Window & { __livePreview?: Api }).__livePreview!.inspect(),
  );
}

async function frameOf(page: Page, url: string, urlPart: string): Promise<Frame> {
  await page.goto(url);
  const frame = await waitForPreviewFrame(page, urlPart);
  // Both host pages assign the frame's src from a script, so the document under
  // the frame can still be swapped while it is asked whether it started. A
  // question asked mid-navigation is not an answer of "no".
  await expect.poll(() => started(frame).catch(() => false), { timeout: 15_000 }).toBe(true);
  return frame;
}

/**
 * A preview token minted for `/`, taken from the host page the way the admin
 * would get it. The oracle needs one of its own: the case that withholds the
 * server render lets the framed page's token expire on purpose.
 */
async function freshSearch(request: APIRequestContext): Promise<string> {
  const host = await (await request.get(`${SSR_APP}/bench?target=/`)).text();
  const src = /src="([^"]*)"/u.exec(host)?.[1];
  expect(src, 'the host page frames the route with a token').toBeDefined();
  return new URL(src!.replaceAll('&amp;', '&'), SSR_APP).search;
}

/** The site's own server, rendering the boundary for exactly these fields. */
async function serverBoundary(
  request: APIRequestContext,
  fields: Readonly<Record<string, unknown>>,
): Promise<string> {
  const response = await request.post(`${SSR_APP}/payload/fragment`, {
    headers: { 'content-type': 'application/json', origin: SSR_APP },
    data: {
      fragment: 'hero',
      route: '/',
      search: await freshSearch(request),
      revision: 1,
      globalSlug: OWNER.globalSlug,
      fields,
    },
  });
  expect(response.status(), 'the fragment endpoint answers the oracle').toBe(200);
  return ((await response.json()) as { html: string }).html;
}

/**
 * The whole assertion of this spec: what the oracle found is what the corpus
 * says it should find — no more, and no less either. A difference that stopped
 * happening has to be struck from the ledger by the change that fixed it,
 * otherwise the next reader believes a limitation that is gone.
 */
function expectRecordedDivergences(
  fixture: FidelityCase,
  differences: readonly Difference[],
): void {
  const recorded = KNOWN_DIVERGENCES.filter((known) => known.case === fixture.name)
    .map((known) => known.signature)
    .sort();
  expect(signaturesOf(differences), reportDifferences(differences)).toEqual(recorded);
}

test.describe('the patched page against the server that would render it', () => {
  test('a static page re-renders every unchanged field into what the server sent', async ({
    page,
    request,
  }) => {
    const fixture = STATIC_FORCED_RENDER;
    const frame = await frameOf(page, `${STATIC_APP}/bench?target=/`, `${STATIC_APP}/`);

    await post(page, STATIC_BASELINE.fields);
    // Let the baseline settle before editing: two messages inside one debounce
    // window are one revision, and then the edit would be a connection's first
    // message again — the one case that is not an edit at all.
    await expect.poll(async () => (await inspect(frame)).revisions.completed).toBe(1);
    await post(page, fixture.fields, {
      // The event Payload's panel attaches to every message once the document
      // has autosaved once. It is what makes the runtime write fields nobody
      // touched, so it is what puts the renderers under the oracle.
      relationshipUpdate: { id: 15, doc: { title: 'a different document' } },
    });
    await expect(frame.locator('[data-payload-field="title"]')).toHaveText('An edited title');
    await expect.poll(async () => (await inspect(frame)).revisions.completed).toBe(2);

    const live = await frame.locator('article').evaluate((element) => element.outerHTML);
    const server = regionOf(await (await request.get(`${STATIC_APP}/`)).text(), 'article');

    expectRecordedDivergences(
      fixture,
      compareFidelity(live, server, { changedFields: fixture.changedFields }),
    );
  });

  test('a boundary the server rendered is the server, exactly', async ({ page, request }) => {
    const fixture = SSR_FRAGMENT_RENDER;
    const frame = await frameOf(page, `${SSR_APP}/bench`, 'preview=true');

    await post(page, fixture.fields, OWNER);
    await expect.poll(async () => (await inspect(frame)).fragments.rendered).toBe(1);

    const live = await frame.getByTestId('hero').innerHTML();
    const server = await serverBoundary(request, fixture.fields);

    expectRecordedDivergences(fixture, compareFidelity(live, server));
  });

  test('a revision the server refused leaves its markup exactly as it was', async ({
    page,
    request,
  }) => {
    const fixture = SSR_REFUSED_RENDER;
    // The page was authorized when it loaded and the endpoint authorizes every
    // request anew, so a short-lived token isolates the case in which the
    // server render is unavailable — without changing an option on the fixture.
    const frame = await frameOf(page, `${SSR_APP}/bench?ttl=1500`, 'preview=true');
    await page.waitForTimeout(2_000);

    await post(page, fixture.fields, OWNER);
    await expect.poll(async () => (await inspect(frame)).fragments.failed).toBe(1);

    const live = await frame.getByTestId('hero').innerHTML();
    // The baseline, not the revision: the revision contains a node only the
    // site's server can render, so the honest outcome is markup that did not
    // move. Half of it having moved would be the failure this measures.
    const server = await serverBoundary(request, {});

    expectRecordedDivergences(fixture, compareFidelity(live, server));
  });

  test('every recorded divergence names the work item that deletes it', () => {
    const cases = [STATIC_FORCED_RENDER.name, SSR_FRAGMENT_RENDER.name, SSR_REFUSED_RENDER.name];
    for (const known of KNOWN_DIVERGENCES) {
      expect(cases, `${known.signature} belongs to a case the oracle runs`).toContain(known.case);
      expect(
        TASKS_THAT_REMOVE_EXCEPTIONS as readonly string[],
        `${known.signature} names the work item that removes it`,
      ).toContain(known.task);
      expect(known.why.length, `${known.signature} says why it is tolerated`).toBeGreaterThan(20);
    }
  });
});
