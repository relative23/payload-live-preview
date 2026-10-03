/**
 * All four public fragment bindings share the depth refusal.
 * The contract verifies that the diagnostic exposes no draft or registry details.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint as astro } from '@adapters/astro/fragments';
import { createFragmentEndpoint as next } from '@adapters/nextjs/fragments';
import { createFragmentEndpoint as nuxt } from '@adapters/nuxt/fragments';
import { createFragmentEndpoint as sveltekit } from '@adapters/sveltekit/fragments';
import type { FragmentRenderInput } from '@adapters/shared/fragment-endpoint';
import { isLexicalContent, lexicalToHtml } from '@/lexical/render';
import table from '../../fixtures/fragment/lexical-table-request.json' with { type: 'json' };

const SITE = 'https://site.example.com';
const Component = () => null;

function setup(fieldDepth?: unknown, editor = true) {
  const verify = vi.fn(() => (editor ? { subject: 'review-editor' } : null));
  const props = vi.fn((input: FragmentRenderInput) => {
    const blocks = input.fields['blocks'];
    const first: unknown = Array.isArray(blocks) ? blocks[0] : undefined;
    const content =
      typeof first === 'object' && first !== null && 'content' in first ? first.content : undefined;
    return { content };
  });
  const render = vi.fn((_component: unknown, values: Record<string, unknown>) => {
    const content = values['content'];
    return Promise.resolve(isLexicalContent(content) ? lexicalToHtml(content, { document }) : '');
  });
  return {
    verify,
    props,
    render,
    options: {
      registry: { 'page-blocks': { component: Component, props } },
      authorize: { type: 'verifier' as const, verify },
      render,
      limits: { ...(fieldDepth === undefined ? {} : { fieldDepth: fieldDepth as number }) },
    },
  };
}

type Options = ReturnType<typeof setup>['options'];
const bindings = [
  [
    'Astro',
    (options: Options) => {
      const handler = astro(options);
      return (request: Request) => handler({ request });
    },
  ],
  ['Next.js', (options: Options) => next(options)],
  ['Nuxt', (options: Options) => nuxt(options)],
  [
    'SvelteKit',
    (options: Options) => {
      const handler = sveltekit(options);
      return (request: Request) => handler({ request });
    },
  ],
] as const;

function request(overrides: Record<string, unknown> = {}, origin = SITE): Request {
  return new Request(`${SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ ...table, ...overrides }),
  });
}

function headers(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('x-payload-fragment-version')).toBe('1');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
}

describe.each(bindings)('%s fragment depth contract', (_name, create) => {
  it.each([undefined, 15, 24])('renders the reported table with cap %s', async (cap) => {
    const state = setup(cap);
    const response = await create(state.options)(request());
    expect(response.status).toBe(200);
    headers(response);
    const body = (await response.json()) as { html: string };
    const parsed = new DOMParser().parseFromString(body.html, 'text/html');
    expect(parsed.querySelector('table tbody tr th')?.textContent).toBe('Example');
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.props).toHaveBeenCalledTimes(1);
    expect(state.props.mock.calls[0]?.[0].fields).toEqual(table.fields);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it('refuses the table under a stricter cap before authorization or rendering', async () => {
    const state = setup(14);
    const handler = create(state.options);
    for (const fragment of ['page-blocks', 'unregistered']) {
      const response = await handler(request({ fragment }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'field-depth', maxDepth: 14 });
      headers(response);
    }
    expect(state.verify).not.toHaveBeenCalled();
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });

  it('keeps shape, origin and authorization refusals generic', async () => {
    const state = setup(14, false);
    const handler = create(state.options);
    const malformed = await handler(request({ fragment: '../secret' }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'shape' });
    headers(malformed);
    const foreign = await handler(request({}, 'https://foreign.example.com'));
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: 'origin' });
    headers(foreign);
    expect(state.verify).not.toHaveBeenCalled();
    const anonymous = await handler(request({ fields: {} }));
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toEqual({ error: 'unauthorized' });
    headers(anonymous);
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.props).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });

  it('supports a zero cap only for an empty fields record', async () => {
    const state = setup(0);
    const handler = create(state.options);
    const empty = await handler(request({ fields: {} }));
    expect(empty.status).toBe(200);
    for (const value of [null, 0, {}, []]) {
      const response = await handler(request({ fields: { value } }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'field-depth', maxDepth: 0 });
      headers(response);
    }
    expect(state.verify).toHaveBeenCalledTimes(1);
    expect(state.props).toHaveBeenCalledTimes(1);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, 65, NaN, Infinity, '24', null])(
    'refuses invalid configuration %s before processing any request',
    (cap) => {
      const state = setup(cap);
      expect(() => create(state.options)).toThrow(TypeError);
      expect(state.verify).not.toHaveBeenCalled();
      expect(state.props).not.toHaveBeenCalled();
      expect(state.render).not.toHaveBeenCalled();
    },
  );
});
