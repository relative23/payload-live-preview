/**
 * Population belongs to the page consumers, including islands, fragments and
 * secondary attributes. Real message envelopes and transport responses keep
 * those consumers complete while scalar-only pages avoid an authenticated read.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RuntimeOptions } from '@core/lifecycle';
import { ISLAND_EVENT, type IslandUpdateDetail } from '@core/islands';
import { fragmentStrategyFrom, type StrategyRequest } from '@fragment/index';
import { EventEmitter } from '@events/emitter';
import { emailRenderer } from '@field-types/email';
import { post, startRuntime, textRenderer, TRUSTED } from '../../helpers/runtime';
import { populationURL } from '../../helpers/population';

const venue = {
  id: 'venue-1',
  title: 'Resolved venue',
  url: 'https://cdn.example.com/venue.jpg',
  alt: 'Resolved caption',
};
const schema = [
  { name: 'label', type: 'email' },
  { name: 'venue', type: 'relationship', relationTo: 'venues' },
];

function populationFetch(): Mock<typeof fetch> {
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify({ docs: [venue] }))),
  );
}

function start(fetchFn: typeof fetch, options: Partial<RuntimeOptions> = {}) {
  return startRuntime({
    eventSourcePolicy: 'any',
    autoBind: 'off',
    renderers: { text: textRenderer(), email: emailRenderer },
    dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
    ...options,
  }).runtime;
}

function postRelationship(): void {
  post(
    { label: 'reader@example.com', venue: 'venue-1' },
    { extra: { collectionSlug: 'events', fieldSchemaJSON: schema } },
  );
}

function expectPopulationRead(fetchFn: Mock<typeof fetch>): void {
  expect(fetchFn).toHaveBeenCalledOnce();
  const [input, init] = fetchFn.mock.calls[0]!;
  expect(populationURL(input).pathname).toBe('/api/venues');
  expect(populationURL(input).searchParams.get('where[id][in]')).toBe('venue-1');
  expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'error' });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('population consumers beyond primary field bindings', () => {
  it('hands an island its populated document without touching its owned subtree', async () => {
    document.body.innerHTML = '<section data-payload-island><p>Framework-owned SSR</p></section>';
    const island = document.querySelector('section')!;
    const received: IslandUpdateDetail[] = [];
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<IslandUpdateDetail>).detail;
      received.push(detail);
      detail.displayed();
    };
    island.addEventListener(ISLAND_EVENT, receive);
    const fetchFn = populationFetch();
    const runtime = start(fetchFn);
    try {
      postRelationship();
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]?.fields['venue']).toEqual(venue);
      expect(island.innerHTML).toBe('<p>Framework-owned SSR</p>');
      expectPopulationRead(fetchFn);
    } finally {
      runtime.destroy();
      island.removeEventListener(ISLAND_EVENT, receive);
    }
  });

  it('populates a nested href beside a complete email scalar', async () => {
    document.body.innerHTML =
      '<a data-payload-field="label" data-payload-type="email" data-payload-href="venue.url" href="SSR">Old email</a>';
    const link = document.querySelector('a')!;
    const fetchFn = populationFetch();
    const runtime = start(fetchFn);
    try {
      postRelationship();
      await vi.waitFor(() => expect(link.getAttribute('href')).toBe(venue.url));
      expect(link.textContent).toBe('reader@example.com');
      expectPopulationRead(fetchFn);
    } finally {
      runtime.destroy();
    }
  });

  it('renders a complete top-level href without a population round trip', async () => {
    document.body.innerHTML =
      '<a data-payload-field="label" data-payload-type="email" data-payload-href="url" href="SSR">Old email</a>';
    const link = document.querySelector('a')!;
    const data = { id: 'event-1', label: 'reader@example.com', url: venue.url };
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(data))));
    const runtime = start(fetchFn);
    try {
      post({ ...data }, { extra: { collectionSlug: 'events' } });
      await vi.waitFor(() => expect(link.getAttribute('href')).toBe(venue.url));
      expect(link.textContent).toBe('reader@example.com');
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      runtime.destroy();
    }
  });

  it('hands a fragment-only boundary the populated relationship it renders', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="card" data-payload-depends="venue">SSR body</section>';
    const requests: StrategyRequest[] = [];
    const fragment = fragmentStrategyFrom((request) => {
      requests.push(request);
      const value = request.fields['venue'];
      const title =
        value !== null && typeof value === 'object' && 'title' in value
          ? String(value.title)
          : String(value);
      return Promise.resolve({ status: 'rendered', html: `<p>${title}</p>` });
    });
    const fetchFn = populationFetch();
    const runtime = start(fetchFn, { strategies: { fragment } });
    try {
      postRelationship();
      await vi.waitFor(() =>
        expect(document.querySelector('section p')?.textContent).toBe(venue.title),
      );
      expect(requests[0]?.fields['venue']).toEqual(venue);
      expectPopulationRead(fetchFn);
    } finally {
      runtime.destroy();
    }
  });

  it('keeps a configured fragment strategy silent on a page without a boundary', async () => {
    document.body.innerHTML = '<main>No fragment boundary</main>';
    const fragment = fragmentStrategyFrom(() =>
      Promise.resolve({ status: 'rendered', html: '<p>Rendered</p>' }),
    );
    const fetchFn = populationFetch();
    const runtime = start(fetchFn, { strategies: { fragment } });
    try {
      postRelationship();
      await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(1));
      expect(document.body.innerHTML).toBe('<main>No fragment boundary</main>');
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      runtime.destroy();
    }
  });

  it('renders a newly filled scalar while its shared trailing read is still pending', async () => {
    document.body.innerHTML =
      '<h1 data-payload-field="title">SSR title</h1><p data-payload-field="summary">SSR summary</p>';
    const emitter = new EventEmitter();
    const documents: Record<string, unknown>[] = [];
    emitter.on('beforeUpdate', (event) => {
      documents.push(event.data.fields);
    });
    let settle!: (response: Response) => void;
    const trailing = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7, title: null, summary: 'Empty' })))
      .mockReturnValueOnce(trailing);
    const runtime = start(fetchFn, { emitter, debounceMs: 50 });
    try {
      post({ id: 7, title: null }, { extra: { collectionSlug: 'events' } });
      await vi.advanceTimersByTimeAsync(20);
      expect(documents[0]?.['title']).toBeNull();
      post({ id: 7, title: 'Typed' }, { extra: { collectionSlug: 'events' } });
      await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Typed'));
      expect(document.querySelector('p')?.textContent).toBe('Empty');
      expect(documents.at(-1)?.['title']).toBe('Typed');
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
      expect(
        fetchFn.mock.calls.map(([, init]) => {
          if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
          return JSON.parse(init.body) as unknown;
        }),
      ).toEqual([
        { data: { id: 7, title: null }, depth: 1, flattenLocales: false },
        { data: { id: 7, title: 'Typed' }, depth: 1, flattenLocales: false },
      ]);
      settle(new Response(JSON.stringify({ id: 7, title: 'Typed', summary: 'Refined' })));
      await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Refined'));
      expect(document.querySelector('h1')?.textContent).toBe('Typed');
    } finally {
      runtime.destroy();
      emitter.removeAllListeners();
    }
  });
});
