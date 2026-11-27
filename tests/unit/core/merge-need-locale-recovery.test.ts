/**
 * A failed read must not certify the retained population for another locale.
 * Recovery is driven by a later accepted message, without an internal retry loop.
 */
import { describe, expect, it, vi } from 'vitest';
import { post, startRuntime, TRUSTED } from '../../helpers/runtime';

const raw = { author: 'A' };

/**
 * A page that shows the author's name, for the cases that switch the author from A to B. Under
 * the declared rule, the default since 3.0, the id of the document that came with the switch is a
 * changed path of its own, so the page says that it accounts for it; without the cover a recovered
 * revision would be `partial` for that reason and hide what these cases are about.
 */
const SWITCHED_AUTHOR_PAGE =
  '<h1 data-payload-field="title">Initial title</h1>' +
  '<p data-payload-field="author.name" data-payload-covers="author.id">Initial author</p>';

/** Every update names its document, as the admin of Payload 3 and 4 does. */
function send(fields: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  post({ id: '1', ...fields }, { extra: { collectionSlug: 'posts', ...extra } });
}

interface MergeBody {
  readonly data: { readonly author: string };
  readonly locale?: string;
}

function bodyOf(init: RequestInit | undefined): MergeBody {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('the merge posts a JSON string');
  return JSON.parse(body) as MergeBody;
}

/** The server's answer: the posted values with the author populated under `name`. */
function merged(name: string): typeof fetch {
  return (_input, init) => {
    const { data } = bodyOf(init);
    return Promise.resolve(
      new Response(JSON.stringify({ ...data, author: { id: data.author, name } })),
    );
  };
}

describe('population after locale read refusal', () => {
  it.each(['fr', 'en'] as const)(
    'keeps the last successful locale after refusal before the next %s update',
    async (nextLocale) => {
      document.body.innerHTML = '<p data-payload-field="author.name">Initial</p>';
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(merged('Ada en'))
        .mockResolvedValueOnce(new Response('Access denied', { status: 403 }))
        .mockImplementationOnce(merged('Ada fr'));
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const name = document.querySelector('p');
      try {
        send({ ...raw }, { locale: 'en' });
        await vi.waitFor(() => expect(name?.textContent).toBe('Ada en'));
        send({ ...raw }, { locale: 'fr' });
        await vi.waitFor(() =>
          expect(runtime.inspect().revisions.display).toMatchObject({
            state: 'partial',
            shortfalls: [{ kind: 'merge' }],
          }),
        );
        expect(name?.textContent).toBe('Ada en');

        send({ ...raw }, { locale: nextLocale });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(nextLocale === 'fr' ? 3 : 2);
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).locale ?? null)).toEqual(
          nextLocale === 'fr' ? ['en', 'fr', 'fr'] : ['en', 'fr'],
        );
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

describe('population before any successful locale context', () => {
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
      fetchFn.mockImplementationOnce(merged('Ada recovered'));
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const data = { author: 'A', title: 'Typed default' };
      try {
        send({ ...data });
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
        send({ ...data });
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(2));
        expect(fetchFn).toHaveBeenCalledTimes(2);
        await vi.waitFor(() =>
          expect(document.querySelector('p')?.textContent).toBe('Ada recovered'),
        );
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(fetchFn.mock.calls.map(([, init]) => 'locale' in bodyOf(init))).toEqual([
          false,
          false,
        ]);
        send({ ...data });
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

describe('population after a same-locale relationship refusal', () => {
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
      document.body.innerHTML = SWITCHED_AUTHOR_PAGE;
      const fetchFn = vi.fn<typeof fetch>().mockImplementationOnce(merged('Ada A'));
      if (fault === 'http') {
        fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
      } else {
        fetchFn.mockRejectedValueOnce(new Error('offline'));
      }
      fetchFn.mockImplementationOnce(merged('Bob B'));
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const first = { author: 'A', title: 'Typed A' };
      const changed = { author: 'B', title: 'Typed B' };
      const envelope = locale === undefined ? {} : { locale };
      try {
        send({ ...first }, envelope);
        await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Ada A'));
        expect(fetchFn).toHaveBeenCalledOnce();

        send({ ...changed }, envelope);
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
        send({ ...changed }, envelope);
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(3);
        await vi.waitFor(() => expect(document.querySelector('p')?.textContent).toBe('Bob B'));
        expect(document.querySelector('h1')?.textContent).toBe('Typed B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).data.author)).toEqual([
          'A',
          'B',
          'B',
        ]);
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).locale ?? null)).toEqual([
          locale ?? null,
          locale ?? null,
          locale ?? null,
        ]);
        send({ ...changed }, envelope);
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

describe('population behind shared trailing merge results', () => {
  it.each([
    ['en', 'http'],
    ['en', 'exception'],
    [undefined, 'http'],
    [undefined, 'exception'],
  ] as const)(
    'keeps B unresolved after leading and shared trailing refusal (%s locale, %s refusal)',
    async (locale, fault) => {
      vi.useFakeTimers();
      document.body.innerHTML = SWITCHED_AUTHOR_PAGE;
      const fetchFn = vi.fn<typeof fetch>().mockImplementationOnce(merged('Ada A'));
      for (let index = 0; index < 2; index += 1) {
        if (fault === 'http') {
          fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
        } else {
          fetchFn.mockRejectedValueOnce(new Error('offline'));
        }
      }
      fetchFn.mockImplementationOnce(merged('Bob B'));
      const { runtime } = startRuntime({
        debounceMs: 50,
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
      const envelope = locale === undefined ? {} : { locale };
      const changed = { author: 'B', title: 'Typed B' };
      try {
        send({ author: 'A', title: 'Typed A' }, envelope);
        await vi.advanceTimersByTimeAsync(100);
        expect(document.querySelector('p')?.textContent).toBe('Ada A');
        expect(fetchFn).toHaveBeenCalledOnce();

        send({ ...changed }, envelope);
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'pending',
          shortfalls: [{ kind: 'merge' }],
        });
        send({ ...changed }, envelope);
        send({ ...changed }, envelope);
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

        send({ ...changed }, envelope);
        await vi.advanceTimersByTimeAsync(100);
        expect(fetchFn).toHaveBeenCalledTimes(4);
        expect(document.querySelector('p')?.textContent).toBe('Bob B');
        expect(runtime.inspect().revisions.display).toMatchObject({
          state: 'current',
          shortfalls: [],
        });
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).data.author)).toEqual([
          'A',
          'B',
          'B',
          'B',
        ]);
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).locale ?? null)).toEqual([
          locale ?? null,
          locale ?? null,
          locale ?? null,
          locale ?? null,
        ]);
        send({ ...changed }, envelope);
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
        .mockImplementationOnce(merged('Ada A'))
        .mockImplementationOnce(merged(change === 'related-save' ? 'Ada refreshed' : 'Bob B'));
      const { runtime } = startRuntime({
        eventSourcePolicy: 'any',
        dataMerge: { serverURL: TRUSTED, depth: 1, fetchFn },
      });
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
        send({ ...first }, envelope);
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(1));
        expect(name.textContent).toBe('Ada A');
        expect(fetchFn).toHaveBeenCalledOnce();

        name.removeAttribute('data-payload-field');
        runtime.refreshCache();
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(runtime.inspect().revisions.display).toMatchObject({ revision: 1 });
        send(
          { ...changed },
          {
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
        );
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(2));
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(document.querySelector('h1')?.textContent).toBe(changed.title);
        expect(name.textContent).toBe('Ada A');

        name.setAttribute('data-payload-field', 'author.name');
        runtime.refreshCache();
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(runtime.inspect().revisions.display).toMatchObject({ revision: 2 });
        send({ ...changed }, envelope);
        await vi.waitFor(() => expect(runtime.inspect().revisions.completed).toBe(3));
        expect(fetchFn).toHaveBeenCalledTimes(readsAgain ? 2 : 1);
        expect(name.textContent).toBe(expectedName);
        expect(document.querySelector('h1')?.textContent).toBe(changed.title);
        expect(runtime.inspect().revisions.display).toMatchObject({
          revision: 3,
          state: 'current',
          shortfalls: [],
        });
        expect(fetchFn.mock.calls.map(([, init]) => bodyOf(init).data.author)).toEqual(
          readsAgain ? ['A', changed.author] : ['A'],
        );
        send({ ...changed }, envelope);
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
