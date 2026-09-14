import { expect, test, type APIRequestContext } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { findUniqueBindings } from '../../../src/core/auto-bind';
import { STATIC_BASELINE } from '../../fixtures/fidelity-corpus';
import { ASTRO_ORIGIN } from '../helpers/preview';

/**
 * F2 of ADR 0014, measured on the shipped fixtures without changing them: how
 * many of the bindings each page declares would `autoBind: 'unique'` have
 * found on its own, and why not the rest.
 *
 * The page is fetched as the server renders it, every `data-payload-*`
 * attribute is taken off a copy, and the search the runtime runs on its first
 * message is run over that copy against the document the fixture's mock admin
 * posts. A declared binding counts as recovered when the search binds the same
 * element to the same field — or, for an upload, to the field the declaration
 * names. The numbers are exact and asserted in both directions, like the
 * interaction budget: a recovery nobody records here fails as loudly as a loss.
 */

const SVELTEKIT = 'http://localhost:4175';

/**
 * The SvelteKit fixture is the strict showcase: its bindings exist only on a
 * response that carries the signed token its mock admin fetches from the
 * example's own endpoint, so the measurement asks for one the same way.
 */
async function sveltekitPreviewUrl(request: APIRequestContext): Promise<string> {
  const token = await (await request.get(`${SVELTEKIT}/preview-token?path=%2F`)).text();
  return `${SVELTEKIT}/?preview=true&previewToken=${encodeURIComponent(token)}`;
}

/** The four fixtures render the same document and the same markup, one per framework. */
const FIXTURES = [
  { name: 'astro-payload', url: () => Promise.resolve(`${ASTRO_ORIGIN}/`) },
  { name: 'nextjs-payload', url: () => Promise.resolve('http://localhost:4174/?preview=true') },
  { name: 'sveltekit-payload', url: sveltekitPreviewUrl },
  { name: 'nuxt-payload', url: () => Promise.resolve('http://localhost:4176/?preview=true') },
] as const;

/**
 * The declared bindings on every one of the four pages, with what the search
 * does about each. The reason column is the finding: it is what stands between
 * a page with no attributes and one that previews every field.
 */
const EXPECTED = {
  recovered: ['ctaLabel', 'hero', 'publishedAt', 'subtitle', 'title'],
  missed: {
    body: 'rich text: not a scalar',
    count: 'a number, and its text is only digits',
    tags: 'an array: not a scalar',
  },
} as const;

interface Declared {
  readonly field: string;
  readonly element: Element;
}

interface Recovery {
  readonly recovered: string[];
  readonly missed: Record<string, string>;
  readonly guessedElsewhere: string[];
}

/** Every declared binding, then the attributes taken off so the search sees the page a template without them would render. */
function stripDeclarations(body: HTMLElement): Declared[] {
  const declared: Declared[] = [];
  for (const element of body.querySelectorAll('[data-payload-field]')) {
    declared.push({ field: element.getAttribute('data-payload-field') ?? '', element });
  }
  for (const element of body.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('data-payload-')) element.removeAttribute(name);
    }
  }
  return declared;
}

function whyMissed(value: unknown, element: Element): string {
  if (Array.isArray(value)) return 'an array: not a scalar';
  if (typeof value === 'number') return 'a number, and its text is only digits';
  if (typeof value === 'object' && value !== null) {
    return 'root' in value
      ? 'rich text: not a scalar'
      : 'a group the page shows nowhere as a whole';
  }
  const text = element.textContent.trim();
  if (typeof value === 'string' && text !== value) {
    return `formatted: the page shows ${JSON.stringify(text)}`;
  }
  return 'ambiguous or absent';
}

function measure(html: string, fields: Readonly<Record<string, unknown>>): Recovery {
  const { document } = new JSDOM(html).window;
  const declared = stripDeclarations(document.body);
  const found = findUniqueBindings(document.body, fields, undefined);
  const byElement = new Map(found.map((candidate) => [candidate.element, candidate.fieldName]));
  const recovered: string[] = [];
  const missed: Record<string, string> = {};
  for (const { field, element } of declared) {
    const guessed = byElement.get(element);
    if (guessed === field) {
      recovered.push(field);
      byElement.delete(element);
      continue;
    }
    missed[field] = whyMissed(fields[field], element);
  }
  return {
    recovered: recovered.sort(),
    missed,
    // A guess on an element no declaration names would be F1's failure on a real page.
    guessedElsewhere: [...byElement.values()].sort(),
  };
}

async function fetchPage(request: APIRequestContext, url: string): Promise<string> {
  const response = await request.get(url);
  expect(response.status(), `${url} answers`).toBe(200);
  return response.text();
}

/** One fixture: the search over its page against the document its admin posts, held to the table above. */
async function expectRecovery(
  request: APIRequestContext,
  url: (request: APIRequestContext) => Promise<string>,
): Promise<void> {
  const recovery = measure(await fetchPage(request, await url(request)), STATIC_BASELINE.fields);
  expect(recovery.guessedElsewhere, 'no guess lands where nothing was declared').toEqual([]);
  expect(recovery.recovered).toEqual([...EXPECTED.recovered]);
  expect(recovery.missed).toEqual(EXPECTED.missed);
}

test.describe('what autoBind would have found on the shipped fixtures', () => {
  // One test per fixture, written out: the inventory counts declarations statically.
  test('astro-payload: 5 of 8 declared bindings, none elsewhere', async ({ request }) => {
    await expectRecovery(request, FIXTURES[0].url);
  });

  test('nextjs-payload: 5 of 8 declared bindings, none elsewhere', async ({ request }) => {
    await expectRecovery(request, FIXTURES[1].url);
  });

  test('sveltekit-payload: 5 of 8 declared bindings, none elsewhere', async ({ request }) => {
    await expectRecovery(request, FIXTURES[2].url);
  });

  test('nuxt-payload: 5 of 8 declared bindings, none elsewhere', async ({ request }) => {
    await expectRecovery(request, FIXTURES[3].url);
  });

  test('the four pages declare the same eight bindings', async ({ request }) => {
    const names = await Promise.all(
      FIXTURES.map(async (fixture) => {
        const page = await fetchPage(request, await fixture.url(request));
        const { document } = new JSDOM(page).window;
        return [...document.body.querySelectorAll('[data-payload-field]')]
          .map((element) => element.getAttribute('data-payload-field'))
          .sort();
      }),
    );
    for (const list of names) expect(list).toEqual(names[0]);
    expect(names[0]).toHaveLength(8);
  });
});
