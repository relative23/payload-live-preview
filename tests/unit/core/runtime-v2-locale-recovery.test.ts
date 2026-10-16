/**
 * A failed read must not certify the retained population for another locale.
 * Recovery is driven by a later accepted message, without an internal retry loop.
 */
import { describe, expect, it, vi } from 'vitest';
import { post, startRuntime, TRUSTED } from '../../helpers/runtime';
import { populationURL } from '../../helpers/population';

const schema = [{ name: 'author', type: 'relationship', relationTo: 'authors' }];
const raw = { author: 'A' };

describe('legacy population after locale read refusal', () => {
  it.each(['fr', 'en'] as const)(
    'keeps the last successful locale after refusal before the next %s update',
    async (nextLocale) => {
      document.body.innerHTML = '<p data-payload-field="author.name">Initial</p>';
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada en' }] })),
        )
        .mockResolvedValueOnce(new Response('Access denied', { status: 403 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada fr' }] })),
        );
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const name = document.querySelector('p');
      try {
        post({ ...raw }, { extra: { fieldSchemaJSON: schema, locale: 'en' } });
        await vi.waitFor(() => expect(name?.textContent).toBe('Ada en'));
        post({ ...raw }, { extra: { locale: 'fr' } });
        await vi.waitFor(() =>
          expect(runtime.inspect().revisions.display).toMatchObject({
            state: 'partial',
            shortfalls: [{ kind: 'merge' }],
          }),
        );
        expect(name?.textContent).toBe('Ada en');

        post({ ...raw }, { extra: { locale: nextLocale } });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(nextLocale === 'fr' ? 3 : 2);
        expect(
          fetchFn.mock.calls.map(([input]) => populationURL(input).searchParams.get('locale')),
        ).toEqual(nextLocale === 'fr' ? ['en', 'fr', 'fr'] : ['en', 'fr']);
        await vi.waitFor(() => expect(name?.textContent).toBe(`Ada ${nextLocale}`));
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(raw).toEqual({ author: 'A' });
      } finally {
        runtime.destroy();
      }
    },
  );
});

describe('legacy population before any successful locale context', () => {
  it.each([
    ['http', false],
    ['http', true],
    ['exception', false],
    ['exception', true],
  ] as const)(
    'retries the identical default-locale message after first %s refusal (restart: %s)',
    async (fault, restart) => {
      document.body.innerHTML =
        '<h1 data-payload-field="title">Old title</h1><p data-payload-field="author.name">Initial</p>';
      const fetchFn = vi.fn<typeof fetch>();
      if (fault === 'http') {
        fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
      } else {
        fetchFn.mockRejectedValueOnce(new Error('offline'));
      }
      fetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada recovered' }] })),
      );
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const data = { author: 'A', title: 'Typed default' };
      const fields = [...schema, { name: 'title', type: 'text' }];
      try {
        post({ ...data }, { extra: { fieldSchemaJSON: fields } });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(1));
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'partial',
          shortfalls: [{ kind: 'merge' }],
        });
        expect(document.querySelector('h1')?.textContent).toBe('Typed default');
        expect(document.querySelector('p')?.textContent).toBe('Initial');
        expect(fetchFn).toHaveBeenCalledOnce();

        if (restart) {
          runtime.destroy();
          runtime.start();
        }
        post({ ...data }, restart ? { extra: { fieldSchemaJSON: fields } } : {});
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(2));
        expect(fetchFn).toHaveBeenCalledTimes(2);
        await vi.waitFor(() =>
          expect(document.querySelector('p')?.textContent).toBe('Ada recovered'),
        );
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(
          fetchFn.mock.calls.map(([input]) => populationURL(input).searchParams.has('locale')),
        ).toEqual([false, false]);
        post({ ...data });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(document.querySelector('p')?.textContent).toBe('Ada recovered');
        expect(data).toEqual({ author: 'A', title: 'Typed default' });
      } finally {
        runtime.destroy();
      }
    },
  );
});

describe('legacy population after a same-locale relationship refusal', () => {
  it.each([
    ['en', 'http', false],
    ['en', 'exception', false],
    [undefined, 'http', false],
    [undefined, 'exception', false],
    ['en', 'http', true],
    ['en', 'exception', true],
    [undefined, 'http', true],
    [undefined, 'exception', true],
  ] as const)(
    'retries unchanged B after A succeeded and B failed (%s locale, %s refusal, restart: %s)',
    async (locale, fault, restart) => {
      document.body.innerHTML =
        '<h1 data-payload-field="title">Initial title</h1><p data-payload-field="author.name">Initial author</p>';
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada A' }] })),
        );
      if (fault === 'http') {
        fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
      } else {
        fetchFn.mockRejectedValueOnce(new Error('offline'));
      }
      fetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify({ docs: [{ id: 'B', name: 'Bob B' }] })),
      );
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const fields = [...schema, { name: 'title', type: 'text' }];
      const first = { author: 'A', title: 'Typed A' };
      const changed = { author: 'B', title: 'Typed B' };
      const envelope = locale === undefined ? {} : { locale };
      try {
        post({ ...first }, { extra: { ...envelope, fieldSchemaJSON: fields } });
        await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Ada A'));
        expect(fetchFn).toHaveBeenCalledOnce();

        post({ ...changed }, { extra: envelope });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(2));
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(document.querySelector('p')?.textContent).toBe('Ada A');
        expect(document.querySelector('h1')?.textContent).toBe('Typed B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'partial',
          shortfalls: [{ kind: 'merge' }],
        });

        if (restart) {
          runtime.destroy();
          runtime.start();
        }
        post(
          { ...changed },
          { extra: { ...envelope, ...(restart ? { fieldSchemaJSON: fields } : {}) } },
        );
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(3);
        await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Bob B'));
        expect(document.querySelector('h1')?.textContent).toBe('Typed B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(
          fetchFn.mock.calls.map(([input]) =>
            populationURL(input).searchParams.get('where[id][in]'),
          ),
        ).toEqual(['A', 'B', 'B']);
        expect(
          fetchFn.mock.calls.map(([input]) => populationURL(input).searchParams.get('locale')),
        ).toEqual([locale ?? null, locale ?? null, locale ?? null]);
        post({ ...changed }, { extra: envelope });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(4));
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(document.querySelector('p')?.textContent).toBe('Bob B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(changed).toEqual({ author: 'B', title: 'Typed B' });
      } finally {
        runtime.destroy();
      }
    },
  );
});

describe('legacy population behind shared trailing merge results', () => {
  it.each([
    ['en', 'http'],
    ['en', 'exception'],
    [undefined, 'http'],
    [undefined, 'exception'],
  ] as const)(
    'keeps B unresolved after leading and shared trailing refusal (%s locale, %s refusal)',
    async (locale, fault) => {
      vi.useFakeTimers();
      document.body.innerHTML =
        '<h1 data-payload-field="title">Initial title</h1><p data-payload-field="author.name">Initial author</p>';
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada A' }] })),
        );
      for (let index = 0; index < 2; index += 1) {
        if (fault === 'http') {
          fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
        } else {
          fetchFn.mockRejectedValueOnce(new Error('offline'));
        }
      }
      fetchFn.mockResolvedValueOnce(
        new Response(JSON.stringify({ docs: [{ id: 'B', name: 'Bob B' }] })),
      );
      const { runtime } = startRuntime({
        debounceMs: 50,
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const fields = [...schema, { name: 'title', type: 'text' }];
      const envelope = locale === undefined ? {} : { locale };
      const changed = { author: 'B', title: 'Typed B' };
      try {
        post(
          { author: 'A', title: 'Typed A' },
          { extra: { ...envelope, fieldSchemaJSON: fields } },
        );
        await vi.advanceTimersByTimeAsync(100);
        expect(document.querySelector('p')?.textContent).toBe('Ada A');
        expect(fetchFn).toHaveBeenCalledOnce();

        post({ ...changed }, { extra: envelope });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'pending',
          shortfalls: [{ kind: 'merge' }],
        });
        post({ ...changed }, { extra: envelope });
        post({ ...changed }, { extra: envelope });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(document.querySelector('p')?.textContent).toBe('Ada A');
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchFn).toHaveBeenCalledTimes(3);
        expect(document.querySelector('h1')?.textContent).toBe('Typed B');
        expect(runtime.inspect().revisions.completed).toBe(2);
        expect(runtime.inspect().revisions.display).toMatchObject({
          revision: 4,
          state: 'partial',
          shortfalls: [{ kind: 'merge' }],
        });
        expect(document.querySelector('p')?.textContent).toBe('Ada A');

        post({ ...changed }, { extra: envelope });
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchFn).toHaveBeenCalledTimes(4);
        expect(document.querySelector('p')?.textContent).toBe('Bob B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(
          fetchFn.mock.calls.map(([input]) =>
            populationURL(input).searchParams.get('where[id][in]'),
          ),
        ).toEqual(['A', 'B', 'B', 'B']);
        expect(
          fetchFn.mock.calls.map(([input]) => populationURL(input).searchParams.get('locale')),
        ).toEqual([locale ?? null, locale ?? null, locale ?? null, locale ?? null]);
        post({ ...changed }, { extra: envelope });
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchFn).toHaveBeenCalledTimes(4);
        expect(document.querySelector('p')?.textContent).toBe('Bob B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
      } finally {
        runtime.destroy();
        vi.useRealTimers();
      }
    },
  );
});

describe('retained population when a consumer returns', () => {
  it.each([
    ['relationship', 'en'],
    ['relationship', undefined],
    ['scalar', 'en'],
    ['scalar', undefined],
    ['related-save', 'en'],
    ['related-save', undefined],
    ['unchanged', 'en'],
    ['unchanged', undefined],
  ] as const)(
    'reconciles %s edits made without a population binding (%s locale)',
    async (change, locale) => {
      document.body.innerHTML =
        '<h1 data-payload-field="title">Initial title</h1><p data-payload-field="author.name">Initial author</p>';
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada A' }] })))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              docs: [
                change === 'related-save'
                  ? { id: 'A', name: 'Ada refreshed' }
                  : { id: 'B', name: 'Bob B' },
              ],
            }),
          ),
        );
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const fields = [...schema, { name: 'title', type: 'text' }];
      const envelope = locale === undefined ? {} : { locale };
      const first = { author: 'A', title: 'Typed A' };
      const changed =
        change === 'relationship'
          ? { author: 'B', title: 'Typed B' }
          : change === 'scalar'
            ? { author: 'A', title: 'Typed scalar' }
            : { ...first };
      const readsAgain = change === 'relationship' || change === 'related-save';
      const expectedName =
        change === 'relationship' ? 'Bob B' : change === 'related-save' ? 'Ada refreshed' : 'Ada A';
      const name = document.querySelector('p')!;
      try {
        post({ ...first }, { extra: { ...envelope, fieldSchemaJSON: fields } });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(1));
        expect(name.textContent).toBe('Ada A');
        expect(fetchFn).toHaveBeenCalledOnce();

        name.removeAttribute('data-payload-field');
        runtime.refreshCache();
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(runtime.inspect().revisions.display).toMatchObject({ revision: 1 });
        post(
          { ...changed },
          {
            extra: {
              ...envelope,
              ...(change === 'related-save'
                ? {
                    externallyUpdatedRelationship: {
                      entitySlug: 'authors',
                      id: 'A',
                      updatedAt: '2026-10-04T12:00:00.000Z',
                    },
                  }
                : {}),
            },
          },
        );
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(2));
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(document.querySelector('h1')?.textContent).toBe(changed.title);
        expect(name.textContent).toBe('Ada A');

        name.setAttribute('data-payload-field', 'author.name');
        runtime.refreshCache();
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(runtime.inspect().revisions.display).toMatchObject({ revision: 2 });
        post({ ...changed }, { extra: envelope });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(readsAgain ? 2 : 1);
        expect(name.textContent).toBe(expectedName);
        expect(document.querySelector('h1')?.textContent).toBe(changed.title);
        expect(runtime.inspect().revisions.display).toMatchObject({
          revision: 3,
          state: 'current',
          shortfalls: [],
        });
        expect(
          fetchFn.mock.calls.map(([input]) =>
            populationURL(input).searchParams.get('where[id][in]'),
          ),
        ).toEqual(readsAgain ? ['A', changed.author] : ['A']);
        post({ ...changed }, { extra: envelope });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(4));
        expect(fetchFn).toHaveBeenCalledTimes(readsAgain ? 2 : 1);
        expect(name.textContent).toBe(expectedName);
        expect(changed.author).toBe(change === 'relationship' ? 'B' : 'A');
      } finally {
        runtime.destroy();
      }
    },
  );
});
