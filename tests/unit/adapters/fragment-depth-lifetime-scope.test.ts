/**
 * A stricter JSON cap must leave the endpoint's earlier byte/lifetime checks
 * and later document capability checks intact. The contributor's table is
 * cloned only to supply the identity required by a scoped request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions,
  type FragmentRenderInput,
} from '@adapters/shared/fragment-endpoint';
import { scopedClaims, scopedContext, SCOPE_CMS, SCOPE_SITE } from '../../fixtures/scoped-preview';
import table from '../../fixtures/fragment/lexical-table-request.json' with { type: 'json' };

type Limits = NonNullable<FragmentEndpointOptions<string>['limits']>;

function claims(id: string | number = 0) {
  const value = scopedClaims();
  return {
    ...value,
    scope: {
      ...value.scope,
      payload: {
        serverURL: SCOPE_CMS,
        document: { kind: 'collection' as const, slug: 'posts', id },
        maxDepth: 0,
      },
    },
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    ...table,
    fragment: 'hero',
    route: '/preview',
    search: '?locale=de',
    locale: 'de',
    collectionSlug: 'posts',
    globalSlug: undefined,
    fields: { ...table.fields, id: 0, title: 'Euro €' },
    ...overrides,
  };
}

function request(
  value: unknown,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {},
) {
  return new Request(`${SCOPE_SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SCOPE_SITE, ...options.headers },
    body: JSON.stringify(value),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function harness(limits: Limits = { fieldDepth: 15 }) {
  const context = await scopedContext(claims());
  const authorize = vi.fn(() => context);
  const props = vi.fn((input: FragmentRenderInput) => ({ title: input.fields['title'] }));
  const render = vi.fn((_component: string, values: Record<string, unknown>) =>
    Promise.resolve(`<h1>${String(values['title'])}</h1>`),
  );
  const options = { registry: { hero: { component: 'Hero', props } }, limits };
  const binding = { render, rendererName: 'test' };
  const handler = createFragmentEndpointHandler(
    { ...options, authorizePreview: authorize },
    binding,
  );
  return { handler, authorize, props, render, context, options, binding };
}

function headers(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('x-payload-fragment-version')).toBe('1');
}

afterEach(() => vi.useRealTimers());

describe('fragment field depth with the 2.1 endpoint guards', () => {
  it.each(['declared', 'consumed'] as const)(
    'keeps the %s byte refusal ahead of the depth diagnostic',
    async (mode) => {
      const value = body();
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      const state = await harness({ fieldDepth: 14, bodyBytes: bytes - 1 });
      const response = await state.handler(
        request(value, {
          headers: mode === 'declared' ? { 'content-length': String(bytes) } : {},
        }),
      );
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'body' });
      headers(response);
      expect(state.authorize).not.toHaveBeenCalled();
      expect(state.props).not.toHaveBeenCalled();
      expect(state.render).not.toHaveBeenCalled();
    },
  );

  it('reports the lower cap after a complete read at the exact UTF-8 byte boundary', async () => {
    const value = body();
    const raw = JSON.stringify(value);
    const bytes = new TextEncoder().encode(raw).byteLength;
    expect(bytes).toBeGreaterThan(raw.length);
    const state = await harness({ fieldDepth: 14, bodyBytes: bytes });
    const response = await state.handler(request(value));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'field-depth', maxDepth: 14 });
    headers(response);
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });

  it('keeps a pre-existing abort as a body refusal even for an over-depth document', async () => {
    vi.useFakeTimers();
    const state = await harness({ fieldDepth: 14, totalTimeoutMs: 25 });
    const controller = new AbortController();
    controller.abort();
    const response = await state.handler(request(body(), { signal: controller.signal }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'body' });
    headers(response);
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['body deadline', { timeoutMs: 25 }, 408, 'body'],
    ['total deadline', { timeoutMs: 200, totalTimeoutMs: 25 }, 504, 'timeout'],
  ] as const)(
    'keeps the %s while a lower-cap body stalls',
    async (_label, limits, status, error) => {
      vi.useFakeTimers();
      const state = await harness({ fieldDepth: 14, ...limits });
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(reader) {
          reader.enqueue(new TextEncoder().encode('{"fragment":"hero","fields":'));
        },
        cancel,
      });
      const pending = state.handler(
        new Request(`${SCOPE_SITE}/payload/fragment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: SCOPE_SITE },
          body: stream,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' }),
      );
      await vi.advanceTimersByTimeAsync(30);
      const response = await pending;
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      headers(response);
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
      expect(state.authorize).not.toHaveBeenCalled();
      expect(state.props).not.toHaveBeenCalled();
      expect(state.render).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([0, '0'])('keeps the exact falsy document identity %s with the table', async (id) => {
    const state = await harness();
    const fields = { ...table.fields, id, title: 'Unpublished table €' };
    const response = await state.handler(request(body({ fields })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ html: '<h1>Unpublished table €</h1>' });
    headers(response);
    expect(state.authorize).toHaveBeenCalledOnce();
    expect(state.props.mock.calls[0]?.[0].fields).toEqual(fields);
    expect(state.props.mock.calls[0]?.[0].authorization.scope.payload?.maxDepth).toBe(0);
    expect(state.render).toHaveBeenCalledOnce();
  });

  it.each([
    ['original fixture without identity', { fields: table.fields }],
    ['other document', { fields: { ...table.fields, id: 'post-b' } }],
    ['empty collection slug', { collectionSlug: '' }],
    ['ambiguous empty global slug', { globalSlug: '' }],
    ['other locale', { locale: '' }],
    ['other page route', { route: '/other' }],
  ])('still refuses %s after accepting the JSON depth', async (_label, override) => {
    const state = await harness();
    const response = await state.handler(request(body(override)));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    headers(response);
    expect(state.authorize).toHaveBeenCalledOnce();
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });

  it('keeps a post-read abort ahead of props for an accepted table', async () => {
    vi.useFakeTimers();
    const state = await harness({ fieldDepth: 15, totalTimeoutMs: 25 });
    const controller = new AbortController();
    const authorize = vi.fn(() => {
      controller.abort();
      return state.context;
    });
    const handler = createFragmentEndpointHandler(
      { ...state.options, authorizePreview: authorize },
      state.binding,
    );
    const response = await handler(request(body(), { signal: controller.signal }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'request' });
    headers(response);
    expect(authorize).toHaveBeenCalledOnce();
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['props', 'render'])(
    'keeps token expiry during %s after a table passed',
    async (phase) => {
      vi.useFakeTimers();
      const expiresAt = Date.now() + 50;
      const context = await scopedContext({ ...claims(), expiresAt });
      const props = vi.fn(() => {
        if (phase === 'props') vi.setSystemTime(expiresAt);
        return {};
      });
      const render = vi.fn(() => {
        vi.setSystemTime(expiresAt);
        return Promise.resolve('<h1>Expired table</h1>');
      });
      const handler = createFragmentEndpointHandler(
        {
          registry: { hero: { component: 'Hero', props } },
          authorizePreview: () => context,
          limits: { fieldDepth: 15 },
        },
        { render, rendererName: 'test' },
      );
      const response = await handler(request(body()));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      headers(response);
      expect(props).toHaveBeenCalledOnce();
      expect(render).toHaveBeenCalledTimes(phase === 'props' ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
