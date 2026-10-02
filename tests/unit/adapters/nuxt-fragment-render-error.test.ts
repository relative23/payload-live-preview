/**
 * Vue's production build does not throw a component's setup or render error
 * out of `renderToString`: `handleError` passes it to `app.config.errorHandler`
 * when one is set and otherwise logs it, and the component renders as an empty
 * comment (runtime-core's production bundle). Only the development build
 * rethrows. A fragment that resolved anyway would replace its boundary with
 * nothing instead of being patched (PHD-17). Vitest loads Vue's development
 * build, so this stands in for the production one, exactly that far.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint } from '@adapters/nuxt/fragments';

interface FakeApp {
  readonly component: { readonly fail?: Error };
  readonly config: { errorHandler?: (error: unknown, instance: unknown, info: string) => void };
}

vi.mock('vue', () => ({
  createSSRApp: (component: FakeApp['component']): FakeApp => ({ component, config: {} }),
}));
vi.mock('vue/server-renderer', () => ({
  renderToString: (app: FakeApp): Promise<string> => {
    if (app.component.fail === undefined) return Promise.resolve('<p>rendered</p>');
    if (app.config.errorHandler === undefined) console.error(app.component.fail);
    else app.config.errorHandler(app.component.fail, null, 'setup function');
    return Promise.resolve('<!---->');
  },
}));

const SITE = 'https://site.example.test';

function endpoint(component: FakeApp['component']) {
  return createFragmentEndpoint({
    registry: { probe: { component, props: () => ({}) } },
    authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
  });
}

function request(): Request {
  return new Request(`${SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body: JSON.stringify({
      fragment: 'probe',
      route: '/page',
      search: '',
      revision: 1,
      fields: {},
    }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a Vue fragment whose component throws (PHD-17)', () => {
  it('fails the render instead of answering an empty fragment', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await endpoint({ fail: new ReferenceError('useHead is not defined') })(
      request(),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'render' });
  });

  it('still renders a component that does not throw', async () => {
    const response = await endpoint({})(request());

    expect(response.status).toBe(200);
    expect(((await response.json()) as { html: string }).html).toBe('<p>rendered</p>');
  });
});
