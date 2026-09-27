/**
 * The public endpoint must preserve props even when Container has no props option.
 * Native archive consumers compile the real template; these tests isolate loading,
 * per-call data and failures without installing the optional Astro peer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const peer = vi.hoisted(() => ({ create: vi.fn<() => Promise<unknown>>() }));
vi.mock('astro/container', () => ({ experimental_AstroContainer: peer }));
const bridge = { compiled: true };
const component = { selected: true };
const loadBridge = vi.fn(() => ({ default: bridge }));
const renderToString = vi.fn<(...args: unknown[]) => Promise<string>>();

beforeEach(() => {
  vi.resetModules();
  peer.create.mockReset().mockResolvedValue({ renderToString });
  renderToString.mockReset().mockResolvedValue('<p>selected</p>');
  loadBridge.mockClear();
  vi.doMock('@adapters/astro/FragmentBridge.astro', loadBridge);
});

function request(title = 'selected', fragment = 'card'): Request {
  return new Request('https://site.example/payload/fragment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://site.example' },
    body: JSON.stringify({
      fragment,
      route: '/page',
      search: '?preview=true',
      revision: 1,
      fields: { title, __payloadLivePreviewFragment: { component: 'forged' } },
    }),
  });
}

async function endpoint(render?: () => Promise<string>) {
  const { createFragmentEndpoint } = await import('@adapters/astro/fragments');
  return createFragmentEndpoint({
    authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
    registry: { card: { component, props: (input) => ({ title: input.fields['title'] }) } },
    ...(render ? { render } : {}),
  });
}

describe('Astro default bridge', () => {
  it('passes only registry-selected component props through fresh container locals', async () => {
    const handler = await endpoint();
    expect((await handler({ request: request() })).status).toBe(200);
    expect(loadBridge).toHaveBeenCalledOnce();
    expect(renderToString).toHaveBeenCalledWith(bridge, {
      locals: { __payloadLivePreviewFragment: { component, props: { title: 'selected' } } },
    });
  });

  it('shares container creation but never locals or props between concurrent calls', async () => {
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    peer.create.mockReturnValue(pending);
    const handler = await endpoint();
    const first = handler({ request: request('first') });
    const second = handler({ request: request('second') });
    await vi.waitFor(() => expect(peer.create).toHaveBeenCalledOnce());
    finish({ renderToString });
    expect((await Promise.all([first, second])).map((value) => value.status)).toEqual([200, 200]);
    const options = renderToString.mock.calls.map((call) => call[1]);
    expect(options).toEqual([
      { locals: { __payloadLivePreviewFragment: { component, props: { title: 'first' } } } },
      { locals: { __payloadLivePreviewFragment: { component, props: { title: 'second' } } } },
    ]);
    expect(options[0]).not.toBe(options[1]);
    expect(loadBridge).toHaveBeenCalledOnce();
  });

  it('loads neither container nor bridge for an explicit renderer', async () => {
    const custom = vi.fn(() => Promise.resolve('<p>custom</p>'));
    const handler = await endpoint(custom);
    expect(await (await handler({ request: request() })).json()).toMatchObject({
      html: '<p>custom</p>',
    });
    expect(custom).toHaveBeenCalledOnce();
    expect(peer.create).not.toHaveBeenCalled();
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it('refuses an unknown registry key before loading the default renderer', async () => {
    const handler = await endpoint();
    expect((await handler({ request: request('selected', 'constructor') })).status).toBe(404);
    expect(peer.create).not.toHaveBeenCalled();
    expect(loadBridge).not.toHaveBeenCalled();
  });

  it('answers generically when the internal template cannot load', async () => {
    vi.doMock('@adapters/astro/FragmentBridge.astro', () => {
      throw new Error('internal bridge path must not reach the client');
    });
    const handler = await endpoint();
    const response = await handler({ request: request() });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'render' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(renderToString).not.toHaveBeenCalled();
  });

  it('does not keep a component render rejection in the shared container loader', async () => {
    renderToString.mockRejectedValueOnce(new Error('component failed'));
    const handler = await endpoint();
    expect((await handler({ request: request() })).status).toBe(500);
    expect((await handler({ request: request() })).status).toBe(200);
    expect(peer.create).toHaveBeenCalledOnce();
    expect(renderToString).toHaveBeenCalledTimes(2);
  });
});
