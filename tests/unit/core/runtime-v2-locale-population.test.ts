/**
 * An explicit SDK locale envelope can change while the relationship ID stays put.
 * These synthetic ingress and REST seams distinguish the DOM population cache
 * from the document session; they do not claim a native Payload 2 locale wire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import { post, startRuntime, TRUSTED, type RuntimeHarness } from '../../helpers/runtime';

const schema = [
  { name: 'title', type: 'text' },
  { name: 'author', type: 'relationship', relationTo: 'authors' },
];
const raw = { title: 'Unchanged parent title', author: 'A' };
let harness: RuntimeHarness | undefined;
let unsubscribe: (() => void) | undefined;

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  harness?.runtime.destroy();
  harness = undefined;
  document.body.replaceChildren();
});

function requestURL(input: RequestInfo | URL): URL {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
}

function localizedFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>((input) => {
    const locale = requestURL(input).searchParams.get('locale');
    const docs = locale === 'en' || locale === 'fr' ? [{ id: 'A', name: `Ada ${locale}` }] : [];
    return Promise.resolve(new Response(JSON.stringify({ docs })));
  });
}

function checkReads(fetchFn: ReturnType<typeof localizedFetch>): void {
  expect(fetchFn.mock.calls.map(([input]) => requestURL(input).searchParams.get('locale'))).toEqual(
    ['en', 'fr'],
  );
  for (const [input, init] of fetchFn.mock.calls) {
    const url = requestURL(input);
    expect(url.origin).toBe(TRUSTED);
    expect(url.pathname).toBe('/api/authors');
    expect(url.searchParams.get('where[id][in]')).toBe('A');
    expect(url.searchParams.get('depth')).toBe('1');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
    expect(init?.redirect).toBe('error');
    expect(init?.body).toBeUndefined();
  }
}

describe('v2 schema population across explicit SDK locales', () => {
  it.each([false, true])(
    'refreshes the DOM relationship for en → fr (data.locale control: %s)',
    async (includeControl) => {
      document.body.innerHTML =
        '<main data-payload-owner="global:homepage"><p data-payload-field="author.name">Initial</p></main>' +
        '<aside data-payload-owner="global:other"><p data-payload-field="author.name">Other owner</p></aside>';
      const fetchFn = localizedFetch();
      harness = startRuntime({
        // Match the existing v2 unit ingress seam; source-policy claims are separate.
        eventSourcePolicy: 'any',
        scopeBindingsByOwner: true,
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const title = document.querySelector('main p');
      const data = (locale: string) => (includeControl ? { ...raw, locale } : { ...raw });
      post(data('en'), {
        extra: { globalSlug: 'homepage', fieldSchemaJSON: schema, locale: 'en' },
      });
      await vi.waitFor(() => expect(title?.textContent).toBe('Ada en'));
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(document.querySelector('aside p')?.textContent).toBe('Other owner');

      // Same relationship ID and values; the second packet retains the accepted schema.
      post(data('fr'), { extra: { globalSlug: 'homepage', locale: 'fr' } });
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(title?.textContent).toBe('Ada fr'));
      expect(document.querySelector('aside p')?.textContent).toBe('Other owner');
      checkReads(fetchFn);
      expect(raw).toEqual({ title: 'Unchanged parent title', author: 'A' });
    },
  );

  it('the document session repopulates the same relationship for the explicit en → fr envelope', async () => {
    const fetchFn = localizedFetch();
    const held = new DocumentSession<Record<string, unknown>>(
      { author: { id: 'Initial', name: 'Initial' } },
      {
        serverURL: TRUSTED,
        allowedOrigins: [TRUSTED],
        enableLocalhostMatching: false,
        eventSourcePolicy: 'any',
        fetchFn,
      },
    );
    unsubscribe = held.subscribe(() => {});
    post({ ...raw }, { extra: { globalSlug: 'homepage', fieldSchemaJSON: schema, locale: 'en' } });
    await vi.waitFor(() =>
      expect(held.getSnapshot().data['author']).toEqual({ id: 'A', name: 'Ada en' }),
    );
    expect(fetchFn).toHaveBeenCalledOnce();

    post({ ...raw }, { extra: { globalSlug: 'homepage', locale: 'fr' } });
    await vi.waitFor(() =>
      expect(held.getSnapshot().data['author']).toEqual({ id: 'A', name: 'Ada fr' }),
    );
    expect(held.getSnapshot().status).toBe('live');
    expect(held.getSnapshot().revision).toBe(2);
    checkReads(fetchFn);
  });
});
