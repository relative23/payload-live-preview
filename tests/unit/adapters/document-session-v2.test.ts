/**
 * Authentic scalar corpus and an anonymized projection of the observed v2 relationship shape.
 * HTTP responses are unit seams only; wire data never receives invented slugs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import historical from '../../fixtures/wire-corpus/payload-2.32.3.json' with { type: 'json' };
import actual from '../../fixtures/payload-2-r4-relationship.json' with { type: 'json' };
import { populationURL } from '../../helpers/population';
const first = actual[0]!;
const next = actual[1]!;
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});
function send(packet: Record<string, unknown>, origin: string): void {
  expect(Object.hasOwn(packet, 'globalSlug')).toBe(false);
  expect(Object.hasOwn(packet, 'collectionSlug')).toBe(false);
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: window.parent,
      data: packet,
    }),
  );
}

describe('DocumentSession — actual Payload 2 message shape', () => {
  it('accepts the first scalar schema and schema-free next update without any HTTP', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const session = new DocumentSession(
      { title: 'Initial' },
      {
        serverURL: historical.adminOrigin,
        allowedOrigins: [historical.adminOrigin],
        enableLocalhostMatching: false,
        eventSourcePolicy: 'any',
        fetchFn,
      },
    );
    stops.push(session.subscribe(() => {}));
    for (const index of [0, 2]) {
      const packet = historical.messages[index]!;
      send(packet, historical.adminOrigin);
      await vi.waitFor(() => expect(session.getSnapshot().isLoading).toBe(false));
      expect(session.getSnapshot().status).toBe('live');
      expect(session.getSnapshot().data.title).toBe(packet.data.title);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(session.getSnapshot().revision).toBe(2);
  });

  it('uses its own first schema to populate the subsequent string ID by collection GET', async () => {
    const before = JSON.stringify(actual);
    const id = next.data.author;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ docs: [{ id, name: 'Ada Fixture' }] })));
    const session = new DocumentSession<Record<string, unknown>>(
      { title: 'Initial' },
      {
        serverURL: first.origin,
        allowedOrigins: [first.origin],
        enableLocalhostMatching: false,
        eventSourcePolicy: 'any',
        fetchFn,
      },
    );
    stops.push(session.subscribe(() => {}));
    send(first, first.origin);
    await vi.waitFor(() => expect(session.getSnapshot().isLoading).toBe(false));
    send(next, next.origin);
    await vi.waitFor(() => expect(session.getSnapshot().isLoading).toBe(false));
    expect(session.getSnapshot().status).toBe('live');
    expect(session.getSnapshot().data['author']).toEqual({
      id,
      name: 'Ada Fixture',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(populationURL(url).pathname).toBe('/api/authors');
    expect(populationURL(url).searchParams.get('where[id][in]')).toBe(id);
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has('X-Payload-HTTP-Method-Override')).toBe(false);
    expect(JSON.stringify(actual)).toBe(before);
  });
});

// These unit packets reconstruct the installed Payload 2 empty-container sender contract.
// Their values were not captured from the failing native document-change journey.
const emptyContainers = [
  {
    name: 'tags',
    field: { name: 'tags', type: 'array', fields: [{ name: 'label', type: 'text' }] },
  },
  {
    name: 'layout',
    field: {
      name: 'layout',
      type: 'blocks',
      blocks: [{ slug: 'quote', fields: [{ name: 'label', type: 'text' }] }],
    },
  },
] as const;

describe('DocumentSession — Payload 2 empty-container form sentinel', () => {
  it.each(emptyContainers)(
    'publishes the first schema-owned $name:0 and scalar values without a GET',
    async ({ name, field }) => {
      const fields = [
        { name: 'title', type: 'text' },
        { name: 'author', type: 'relationship', relationTo: 'authors', hasMany: false },
        field,
      ];
      const raw = { title: 'Unsaved fixture title', author: null, [name]: 0 };
      const before = JSON.stringify(raw);
      const fetchFn = vi.fn<typeof fetch>();
      const session = new DocumentSession<Record<string, unknown>>(
        { title: 'Last good', [name]: [{ label: 'Saved row' }] },
        {
          serverURL: first.origin,
          allowedOrigins: [first.origin],
          enableLocalhostMatching: false,
          eventSourcePolicy: 'any',
          fetchFn,
        },
      );
      let settled = 0;
      stops.push(
        session.subscribe(() => {
          if (!session.getSnapshot().isLoading) settled += 1;
        }),
      );
      send({ type: 'payload-live-preview', fieldSchemaJSON: fields, data: raw }, first.origin);
      await vi.waitFor(() => expect(settled).toBe(1));
      expect(session.getSnapshot().status).toBe('live');
      expect(session.getSnapshot().data).toEqual({
        title: 'Unsaved fixture title',
        author: null,
        [name]: [],
      });
      expect(session.getSnapshot().revision).toBe(1);
      expect(session.getSnapshot().error).toBeUndefined();
      expect(session.getSnapshot().data).not.toBe(raw);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(JSON.stringify(raw)).toBe(before);
    },
  );

  it.each(emptyContainers)(
    'uses its retained $name schema for a later zero sentinel and exactly one author GET',
    async ({ name, field }) => {
      const fields = [
        { name: 'title', type: 'text' },
        { name: 'author', type: 'relationship', relationTo: 'authors', hasMany: false },
        field,
      ];
      const raw = { title: 'Unsaved fixture title', author: 'A', [name]: 0 };
      const before = JSON.stringify(raw);
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada' }] })));
      const session = new DocumentSession<Record<string, unknown>>(
        { title: 'Initial' },
        {
          serverURL: first.origin,
          allowedOrigins: [first.origin],
          enableLocalhostMatching: false,
          eventSourcePolicy: 'any',
          fetchFn,
        },
      );
      let settled = 0;
      stops.push(
        session.subscribe(() => {
          if (!session.getSnapshot().isLoading) settled += 1;
        }),
      );
      send(
        {
          type: 'payload-live-preview',
          fieldSchemaJSON: fields,
          data: { title: 'Warm local document', author: null, [name]: [] },
        },
        first.origin,
      );
      await vi.waitFor(() => expect(settled).toBe(1));
      expect(session.getSnapshot().status).toBe('live');
      expect(fetchFn).not.toHaveBeenCalled();
      send({ type: 'payload-live-preview', data: raw }, first.origin);
      await vi.waitFor(() => expect(settled).toBe(2));
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(session.getSnapshot().status).toBe('live');
      expect(session.getSnapshot().data).toEqual({
        title: 'Unsaved fixture title',
        author: { id: 'A', name: 'Ada' },
        [name]: [],
      });
      expect(session.getSnapshot().revision).toBe(2);
      expect(session.getSnapshot().error).toBeUndefined();
      const [input, init] = fetchFn.mock.calls[0] ?? [];
      const url = populationURL(input);
      expect(url.origin).toBe(new URL(first.origin).origin);
      expect(url.pathname).toBe('/api/authors');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        depth: '1',
        limit: '1',
        'where[id][in]': 'A',
      });
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(init?.redirect).toBe('error');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has('X-Payload-HTTP-Method-Override')).toBe(false);
      expect(JSON.stringify(raw)).toBe(before);
    },
  );
});
