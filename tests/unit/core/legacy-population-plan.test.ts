/**
 * Population requests must remain bounded before cookies can leave the page.
 * Positive controls preserve complete identity partitions, encoded queries and
 * exact edge limits; rejected plans make no partial network request.
 */
import { describe, expect, it, vi } from 'vitest';
import { planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const SERVER = 'https://cms.example.com';
const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const many: PayloadFieldSchema = { ...author, hasMany: true };
const plan = (
  data: Record<string, unknown>,
  schema: readonly PayloadFieldSchema[] = [author],
  serverURL = SERVER,
  apiRoute = '/api',
  depth = 1,
  locale?: string,
) => planLegacyPopulation(data, schema, serverURL, apiRoute, depth, locale);

async function refused(
  options: { serverURL?: string; apiRoute?: string; depth?: number } = {},
  data: Record<string, unknown> = { author: 'A' },
  schema: readonly PayloadFieldSchema[] = [author],
  locale?: string,
): Promise<void> {
  const fetchFn = vi.fn<typeof fetch>();
  const merger = new DataMerger({ serverURL: SERVER, ...options, fetchFn });
  const request = { data, schema, locale };
  expect(merger.canMerge(request)).toBe(false);
  await expect(merger.merge(request)).resolves.toEqual({ status: 'unavailable' });
  expect(fetchFn).not.toHaveBeenCalled();
}

describe('legacy population — destinations and identity bounds', () => {
  it.each([
    '.',
    '..',
    '',
    'private/path',
    'private\\path',
    '\u001f',
    '\u007f',
    '\uD800',
    'a'.repeat(129),
    '__proto__',
    'constructor',
    'prototype',
    'authors?',
    'authors#',
    'authors%',
  ])('refuses collection slug %j before fetching', async (relationTo) => {
    await refused({}, { author: 'A' }, [{ ...author, relationTo }]);
  });

  it.each([
    '.',
    '..',
    'path/id',
    'path\\id',
    'a\u001fb',
    'a\u007fb',
    '\uD800',
    'a'.repeat(513),
    true,
    { malformed: true },
  ])('refuses invalid relationship id %j before fetching', async (id) => {
    await refused({}, { author: id });
  });

  it('accepts exact slug/id limits, printable controls and valid encoded Unicode', () => {
    for (const [collection, id] of [
      ['a'.repeat(128), 'b'.repeat(512)],
      ['a b', 'a b'],
      ['a~b', 'a~b'],
      ['autörs', 'draft ?#% ü😀'],
    ] as const) {
      const result = plan({ author: id }, [{ ...author, relationTo: collection }]);
      const url = new URL(result.requests[0]?.url ?? '');
      expect(url.origin).toBe(SERVER);
      expect(decodeURIComponent(url.pathname)).toBe(`/api/${collection}`);
      expect(url.searchParams.get('where[id][in]')).toBe(id);
      expect(result.requests[0]?.ids).toEqual(new Set([id]));
    }
    const name = 'field'.repeat(102) + 'aa';
    const raw = { [name]: 'A' };
    expect(plan(raw, [{ ...author, name }]).requests).toHaveLength(1);
    expect(() => plan(raw, [{ ...author, name: `${name}a` }])).toThrow();
  });

  it.each([
    'ftp://cms.example.com',
    'https://user@cms.example.com',
    'https://:secret@cms.example.com',
    `${SERVER}?draft=true`,
    `${SERVER}#draft`,
  ])('refuses an unsafe CMS base %s', async (serverURL) => {
    await refused({ serverURL });
  });

  it.each([
    '/api/../private',
    '/api/./private',
    '/api\\private',
    '/api%2Fprivate',
    '/api?private',
    '/api#private',
    '/api\u001fprivate',
  ])('refuses an unsafe API route %j', async (apiRoute) => {
    await refused({ apiRoute });
  });

  it('normalizes valid trailing slashes while preserving a configured prefix and explicit locale', () => {
    const result = plan({ author: 'A' }, [author], `${SERVER}/cms///`, '/custom/api///', 64, 'de');
    const url = new URL(result.requests[0]?.url ?? '');
    expect(url.origin).toBe(SERVER);
    expect(url.pathname).toBe('/cms/custom/api/authors');
    expect([...url.searchParams]).toEqual([
      ['depth', '64'],
      ['limit', '1'],
      ['locale', 'de'],
      ['where[id][in]', 'A'],
    ]);
    expect(result.doc).toEqual({ author: 'A' });
  });

  it('requires a leading slash in a direct plan while preserving the caller normalization', async () => {
    expect(() => plan({ author: 'A' }, [author], SERVER, 'api')).toThrow();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada' }] })));
    const merger = new DataMerger({ serverURL: SERVER, apiRoute: 'custom', fetchFn });
    await expect(merger.merge({ data: { author: 'A' }, schema: [author] })).resolves.toEqual({
      status: 'merged',
      doc: { author: { id: 'A', name: 'Ada' } },
    });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      `${SERVER}/custom/authors?depth=1&limit=1&where%5Bid%5D%5Bin%5D=A`,
    );
  });

  it('keeps local scalar output independent of unused remote configuration', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({
      serverURL: 'unused invalid origin',
      apiRoute: '../unused',
      fetchFn,
    });
    const raw = { title: 'Typed', author: null };
    await expect(merger.merge({ data: raw, schema: [author] })).resolves.toEqual({
      status: 'merged',
      doc: raw,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, 65, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses population depth %s before fetching',
    async (depth) => {
      await refused({ depth });
    },
  );

  it('accepts zero and 64 depth without moving the default depth', () => {
    expect(plan({ author: { id: 'A', name: 'Earlier' } }, [author], SERVER, '/api', 0)).toEqual({
      doc: { author: 'A' },
      requests: [],
    });
    expect(new URL(plan({ author: 'A' }).requests[0]?.url ?? '').searchParams.get('depth')).toBe(
      '1',
    );
    expect(
      new URL(
        plan({ author: 'A' }, [author], SERVER, '/api', 64).requests[0]?.url ?? '',
      ).searchParams.get('depth'),
    ).toBe('64');
  });

  it('forwards a 128-character locale exactly and refuses oversized or control-bearing locales', async () => {
    const locale = 'a'.repeat(128);
    expect(
      new URL(
        plan({ author: 'A' }, [author], SERVER, '/api', 1, locale).requests[0]?.url ?? '',
      ).searchParams.get('locale'),
    ).toBe(locale);
    for (const invalid of ['a'.repeat(129), 'de\u001f', 'de\u007f']) {
      await refused({}, { author: 'A' }, [author], invalid);
    }
    expect(() =>
      plan({ author: 'A' }, [author], SERVER, '/api', 1, 0 as unknown as string),
    ).toThrow();
  });
});

describe('legacy population — complete bounded request partitions', () => {
  it('chunks20 ordinary IDs and retains every repeated slot when21 IDs need another request', () => {
    const ids = Array.from({ length: 21 }, (_, index) => `id${index}`);
    const result = plan({ author: [...ids, ids[0]] }, [many]);
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => [...request.ids])).toEqual([
      ids.slice(0, 20),
      ids.slice(20),
    ]);
    expect(result.requests.map((request) => request.slots.length)).toEqual([21, 1]);
    expect(
      result.requests.map((request) => new URL(request.url).searchParams.get('limit')),
    ).toEqual(['20', '1']);
    expect(plan({ author: ids.slice(0, 20) }, [many]).requests).toHaveLength(1);
  });

  it('separates each comma-bearing identity without losing the surrounding ordinary IDs', () => {
    const ids = ['plainA', 'comma,A', 'comma,B', 'plainB', 'plainC'];
    const result = plan({ author: ids }, [many]);
    expect(result.requests.map((request) => [...request.ids])).toEqual([
      ['plainA'],
      ['comma,A'],
      ['comma,B'],
      ['plainB', 'plainC'],
    ]);
    expect(
      result.requests.map((request) => {
        const query = new URL(request.url).searchParams;
        return [query.get('where[id][equals]'), query.get('where[id][in]'), query.get('limit')];
      }),
    ).toEqual([
      [null, 'plainA', '1'],
      ['comma,A', null, '1'],
      ['comma,B', null, '1'],
      [null, 'plainB,plainC', '2'],
    ]);
  });

  it('counts unique identities separately per collection and refuses the 1,001st pair before HTTP', async () => {
    const ids = Array.from({ length: 500 }, (_, index) => `id${index}`);
    const schema: PayloadFieldSchema[] = [
      { name: 'first', type: 'relationship', relationTo: 'authors', hasMany: true },
      { name: 'second', type: 'relationship', relationTo: 'media', hasMany: true },
    ];
    const accepted = plan({ first: [...ids, ids[0]], second: ids }, schema);
    expect(accepted.requests).toHaveLength(50);
    expect(accepted.requests.reduce((total, request) => total + request.ids.size, 0)).toBe(1_000);
    expect(accepted.requests.reduce((total, request) => total + request.slots.length, 0)).toBe(
      1_001,
    );
    await refused({}, { first: ids, second: [...ids, 'extra'] }, schema);
  });

  it('accepts 25 selected collections but refuses a 26th before any partial read', async () => {
    const fields = Array.from({ length: 26 }, (_, index): PayloadFieldSchema => ({
      name: `field${index}`,
      type: 'relationship',
      relationTo: `collection${index}`,
    }));
    const raw = Object.fromEntries(fields.map((field) => [field.name, 'A']));
    const accepted = plan(raw, fields.slice(0, 25));
    expect(accepted.requests).toHaveLength(25);
    expect(accepted.requests.map((request) => new URL(request.url).pathname)).toEqual(
      fields.slice(0, 25).map((field) => `/api/${String(field.relationTo)}`),
    );
    await refused({}, raw, fields);
  });

  it('accepts 64 real singleton reads and refuses the 65th before dispatch', async () => {
    const ids = Array.from({ length: 65 }, (_, index) => `id,${index}`);
    const accepted = plan({ author: ids.slice(0, 64) }, [many]);
    expect(accepted.requests).toHaveLength(64);
    expect(accepted.requests.flatMap((request) => [...request.ids])).toEqual(ids.slice(0, 64));
    expect(
      accepted.requests.every((request) => new URL(request.url).searchParams.get('limit') === '1'),
    ).toBe(true);
    await refused({}, { author: ids }, [many]);
  });

  it('accepts an 8192-character URL and refuses a singleton one character longer', async () => {
    const query = new URLSearchParams({ depth: '1', limit: '1', 'where[id][in]': 'A' });
    const fixed = `${SERVER}/api/authors?${query}`.length;
    const serverURL = `${SERVER}/${'p'.repeat(8_192 - fixed - 1)}`;
    const accepted = plan({ author: 'A' }, [author], serverURL);
    expect(accepted.requests[0]?.url).toHaveLength(8_192);
    expect(new URL(accepted.requests[0]?.url ?? '').origin).toBe(SERVER);
    await refused({ serverURL: `${serverURL}p` });
  });

  it('splits long Unicode identities by encoded URL size before the 20-ID count limit', () => {
    const ids = Array.from({ length: 7 }, (_, index) => `id${index}`.padEnd(512, 'ü'));
    const result = plan({ author: ids }, [many]);
    expect(result.requests.map((request) => request.ids.size)).toEqual([2, 2, 2, 1]);
    expect(result.requests.flatMap((request) => [...request.ids])).toEqual(ids);
    for (const request of result.requests) {
      expect(request.url.length).toBeLessThanOrEqual(8_192);
      const url = new URL(request.url);
      expect(url.origin).toBe(SERVER);
      expect(url.searchParams.get('where[id][in]')).toBe([...request.ids].join(','));
      expect(url.searchParams.get('limit')).toBe(String(request.ids.size));
    }
  });
});
