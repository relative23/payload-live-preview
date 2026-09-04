import { describe, expect, it, vi } from 'vitest';
import { createRouteStrategy, isRouteBound, ROUTE_REFRESH_HEADER } from '@fragment/index';
import type { RouteContext } from '@core/strategies';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const logs: string[] = [];

function context(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    revision: 3,
    receivedAt: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: (code, detail) => {
      logs.push(`${code} ${detail}`);
    },
    ...overrides,
  };
}

function html(
  body: string,
  head = '<title>Fresh title</title><meta name="description" content="fresh">',
): Response {
  return new Response(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('isRouteBound and plan', () => {
  it('treats head bindings and explicit route bindings as route-bound, nothing else', () => {
    document.head.innerHTML = '<title data-payload-field="title">t</title>';
    document.body.innerHTML =
      '<p id="a" data-payload-field="x" data-payload-strategy="route"></p><p id="b" data-payload-field="x"></p><p id="c" data-payload-strategy="patch"></p>';
    expect(isRouteBound(document.querySelector('title')!)).toBe(true);
    expect(isRouteBound(document.getElementById('a')!)).toBe(true);
    expect(isRouteBound(document.getElementById('b')!)).toBe(false);
    expect(isRouteBound(document.getElementById('c')!)).toBe(false);
    const strategy = createRouteStrategy();
    expect(strategy.plan(document, new Set(['title']))).toBe(true);
    expect(strategy.plan(document, new Set(['x']))).toBe(true);
    expect(strategy.plan(document, new Set(['other']))).toBe(false);
    document.head.innerHTML = '';
  });

  it('a route element with data-payload-depends re-renders for those fields', () => {
    document.body.innerHTML =
      '<nav data-payload-strategy="route" data-payload-depends="slug, parent"></nav>';
    const strategy = createRouteStrategy();
    expect(strategy.plan(document, new Set(['parent']))).toBe(true);
    expect(strategy.plan(document, new Set(['title']))).toBe(false);
  });
});

describe('refresh', () => {
  it('fetches the current route with credentials and the refresh header, syncs the head, morphs the body and restores scroll', async () => {
    logs.length = 0;
    document.head.innerHTML = '<title>Old title</title><meta name="description" content="old">';
    document.body.innerHTML =
      '<p data-testid="layout">old layout</p><input id="i" value="typed"><ul><li data-payload-key="a">A</li></ul>';
    const input = document.getElementById('i') as HTMLInputElement;
    input.focus();
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(
        html(
          '<p data-testid="layout">fresh layout</p><input id="i"><ul><li data-payload-key="a">A2</li><li data-payload-key="b">B</li></ul>',
        ),
      ),
    );
    const scrollTo = vi.fn();
    const strategy = createRouteStrategy({
      fetch: fetchFn,
      location: { href: 'https://site.example.com/page?preview=true' },
      window: { scrollX: 0, scrollY: 400, scrollTo },
    });
    expect(await strategy.refresh(context())).toBe('refreshed');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://site.example.com/page?preview=true');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)[ROUTE_REFRESH_HEADER]).toBe('route');
    expect(document.title).toBe('Fresh title');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'fresh',
    );
    expect(document.querySelector('[data-testid="layout"]')?.textContent).toBe('fresh layout');
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(document.getElementById('i')).toBe(input);
    expect(input.value).toBe('typed');
    expect(document.activeElement).toBe(input);
    expect(scrollTo).toHaveBeenCalledWith(0, 400);
    document.head.innerHTML = '';
  });

  it('adds a new meta and updates the canonical link from the fresh head', async () => {
    logs.length = 0;
    document.head.innerHTML = '<title>Old</title><link rel="canonical" href="/old">';
    document.body.innerHTML = '<p data-testid="layout">x</p>';
    const strategy = createRouteStrategy({
      fetch: vi.fn<FetchLike>(() =>
        Promise.resolve(
          html(
            '<p data-testid="layout">y</p>',
            '<title>New</title><meta name="robots" content="noindex"><link rel="canonical" href="/new">',
          ),
        ),
      ),
      location: { href: 'https://site.example.com/' },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
    });
    expect(await strategy.refresh(context())).toBe('refreshed');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('/new');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
    document.head.innerHTML = '';
  });

  it('refuses a second refresh inside the minimum interval with LP0805', async () => {
    logs.length = 0;
    const strategy = createRouteStrategy({
      fetch: vi.fn<FetchLike>(() => Promise.resolve(html('<p></p>'))),
      location: { href: 'https://site.example.com/' },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
      minIntervalMs: 1_000,
    });
    expect(await strategy.refresh(context())).toBe('refreshed');
    expect(await strategy.refresh(context({ revision: 4 }))).toBe('failed');
    expect(logs.some((line) => line.startsWith('LP0805'))).toBe(true);
  });

  it('fails with LP0802 on a non-HTML answer and LP0801 on a network error; abort is superseded', async () => {
    logs.length = 0;
    const base = {
      location: { href: 'https://site.example.com/' },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
      minIntervalMs: 0,
    };
    const notHtml = createRouteStrategy({
      ...base,
      fetch: vi.fn<FetchLike>(() =>
        Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } })),
      ),
    });
    expect(await notHtml.refresh(context())).toBe('failed');
    expect(logs.at(-1)).toMatch(/^LP0802/u);

    const down = createRouteStrategy({
      ...base,
      fetch: vi.fn<FetchLike>(() => Promise.reject(new TypeError('offline'))),
    });
    expect(await down.refresh(context())).toBe('failed');
    expect(logs.at(-1)).toMatch(/^LP0801 offline/u);

    const controller = new AbortController();
    const hanging = createRouteStrategy({
      ...base,
      fetch: vi.fn<FetchLike>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    });
    const pending = hanging.refresh(context({ signal: controller.signal }));
    controller.abort();
    expect(await pending).toBe('superseded');
  });
});

const BASE = {
  location: { href: 'https://site.example.com/' },
  window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
  minIntervalMs: 0,
};

/** An HTML response whose body streams and errors on abort, as a real fetch body does. */
function streamingHtml(head: string, init?: RequestInit, fail?: Error): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (fail !== undefined) {
        controller.error(fail);
        return;
      }
      controller.enqueue(new TextEncoder().encode(head));
      init?.signal?.addEventListener('abort', () => {
        controller.error(new DOMException('aborted', 'AbortError'));
      });
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/html' } });
}

describe('refresh — failures after the headers', () => {
  it('is superseded when the revision is aborted while the body is read, and never rejects', async () => {
    const controller = new AbortController();
    const strategy = createRouteStrategy({
      ...BASE,
      fetch: vi.fn<FetchLike>((_url, init) => Promise.resolve(streamingHtml('<html>', init))),
    });
    const pending = strategy.refresh(context({ signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toBe('superseded');
  });

  it('reports a body that fails to read and a morph that throws as LP0801 failures', async () => {
    logs.length = 0;
    const broken = createRouteStrategy({
      ...BASE,
      fetch: () => Promise.resolve(streamingHtml('', undefined, new Error('stream broke'))),
    });
    expect(await broken.refresh(context())).toBe('failed');
    expect(logs.at(-1)).toBe('LP0801 stream broke');

    const explosive = {
      get title() {
        return '';
      },
      set title(_value: string) {},
      head: document.head,
      importNode: (node: Node) => document.importNode(node, true),
      get body(): HTMLElement {
        throw new Error('morph exploded');
      },
    } as unknown as Document;
    const throwing = createRouteStrategy({
      ...BASE,
      document: explosive,
      fetch: () => Promise.resolve(html('<p>fresh</p>')),
    });
    expect(await throwing.refresh(context())).toBe('failed');
    expect(logs.at(-1)).toBe('LP0801 morph exploded');
    document.head.innerHTML = '';
  });
});

describe('refresh — head sync and body pairing', () => {
  it('removes a named meta the fresh head no longer carries, keeps one marked data-payload-owned and unnamed ones', async () => {
    document.head.innerHTML =
      '<title>t</title><meta charset="utf-8"><meta name="description" content="stale">' +
      '<meta property="og:image" content="/old.png">' +
      '<meta name="generator" content="script" data-payload-owned>';
    document.body.innerHTML = '<p>x</p>';
    const strategy = createRouteStrategy({
      ...BASE,
      fetch: () =>
        Promise.resolve(
          html('<p>y</p>', '<title>t</title><meta name="description" content="fresh">'),
        ),
    });
    expect(await strategy.refresh(context())).toBe('refreshed');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'fresh',
    );
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.querySelector('meta[name="generator"]')?.getAttribute('content')).toBe(
      'script',
    );
    expect(document.querySelector('meta[charset]')).not.toBeNull();
    document.head.innerHTML = '';
  });

  it('pairs sibling fragment boundaries of one id by their fragment key, not by position', async () => {
    document.body.innerHTML =
      '<!-- c --><section data-payload-fragment="card" data-payload-fragment-key="a"><input id="ia" value="typed"></section>' +
      '<section data-payload-fragment="card" data-payload-fragment-key="b"><input id="ib"></section>';
    const a = document.querySelector('[data-payload-fragment-key="a"]');
    const b = document.querySelector('[data-payload-fragment-key="b"]');
    const strategy = createRouteStrategy({
      ...BASE,
      fetch: () =>
        Promise.resolve(
          html(
            '<p>new</p><section data-payload-fragment="card" data-payload-fragment-key="b"></section>' +
              '<section data-payload-fragment="card" data-payload-fragment-key="a"></section>',
          ),
        ),
    });
    expect(await strategy.refresh(context())).toBe('refreshed');
    const sections = Array.from(document.body.querySelectorAll('section'));
    expect(sections.map((section) => section.getAttribute('data-payload-fragment-key'))).toEqual([
      'b',
      'a',
    ]);
    expect(sections[0]).toBe(b);
    expect(sections[1]).toBe(a);
    // The fragment strategy owns the children: the typed value survives the refresh.
    expect((document.getElementById('ia') as HTMLInputElement).value).toBe('typed');
    document.head.innerHTML = '';
  });
});

describe('route refresh — timeout and head elements it does not own', () => {
  it('aborts a refresh that outlives its timeout', async () => {
    vi.useFakeTimers();
    logs.length = 0;
    try {
      const strategy = createRouteStrategy({
        // Never answers on its own; like the real one, it rejects when aborted.
        fetch: vi.fn<FetchLike>(
          (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  reject(new DOMException('The operation was aborted.', 'AbortError'));
                },
                { once: true },
              );
            }),
        ),
        location: { href: 'https://site.example.com/' },
        window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
        minIntervalMs: 0,
        timeoutMs: 1_000,
      });
      const pending = strategy.refresh(context());
      await vi.advanceTimersByTimeAsync(1_100);
      expect(await pending).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves head elements it has no key for alone', async () => {
    logs.length = 0;
    document.head.innerHTML =
      '<title>Old</title><link rel="stylesheet" href="/old.css"><link rel="icon" href="/old.ico">';
    const strategy = createRouteStrategy({
      fetch: vi.fn<FetchLike>(() =>
        Promise.resolve(
          html(
            '<p></p>',
            '<title>Fresh title</title><link rel="stylesheet" href="/fresh.css"><link rel="canonical" href="https://site.example.com/fresh">',
          ),
        ),
      ),
      location: { href: 'https://site.example.com/' },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
      minIntervalMs: 0,
    });
    expect(await strategy.refresh(context())).toBe('refreshed');

    // Keyed elements are synced; a stylesheet is not something this owns.
    expect(document.title).toBe('Fresh title');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://site.example.com/fresh',
    );
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/old.css');
    expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
    document.head.innerHTML = '';
  });
});
