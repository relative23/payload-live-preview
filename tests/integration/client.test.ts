/**
 * Integration tests for `LivePreviewClient`.
 *
 * Exercises the full system end to end: a fake parent window posts
 * Payload messages, the client validates origin, parses payloads,
 * renders into the DOM, and emits lifecycle events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';

const TRUSTED = 'https://admin.example.com';

class IO implements IntersectionObserver {
  static latest: IO | undefined;
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    IO.latest = this;
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  setVisible(element: Element, visible: boolean): void {
    this.callback(
      [{ target: element, isIntersecting: visible } as IntersectionObserverEntry],
      this,
    );
  }
}

function fakeIframe(): void {
  Object.defineProperty(window, 'top', {
    get: () => {
      throw new Error('cross-origin');
    },
    configurable: true,
  });
}

function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

async function fireUpdate(fields: Record<string, unknown>): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data: fields });
  await vi.advanceTimersByTimeAsync(50);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settlesWithinMicrotaskDrain(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  return settled;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  IO.latest = undefined;
  fakeIframe();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LivePreviewClient — end-to-end', () => {
  it('goes quiet while suspended and delivers again after resuming', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });

    try {
      await fireUpdate({ title: 'before' });
      expect(document.querySelector('h1')?.textContent).toBe('before');

      expect(client.suspend()).toBe(true);
      await fireUpdate({ title: 'while suspended' });
      // The ingress is released, so the message reaches nothing at all.
      expect(document.querySelector('h1')?.textContent).toBe('before');

      expect(client.resume()).toBe(true);
      await fireUpdate({ title: 'after' });
      expect(document.querySelector('h1')?.textContent).toBe('after');
    } finally {
      await client.destroy();
    }
  });

  it('keeps plugins across a suspension, unlike destroy', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });

    try {
      await client.use({
        name: 'shouty',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `!${String(value)}`);
        },
      });
      expect(client.suspend()).toBe(true);
      expect(client.resume()).toBe(true);
      await fireUpdate({ title: 'kept' });

      // A rebuild would have lost the transform; a suspension must not.
      expect(document.querySelector('h1')?.textContent).toBe('!kept');
      expect(client.plugins).toContain('shouty');
    } finally {
      await client.destroy();
    }
  });

  it('refuses to suspend or resume a client that never started or was destroyed', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      autoStart: false,
      debounceMs: 0,
    });
    expect(client.suspend()).toBe(false);
    expect(client.resume()).toBe(false);

    expect(client.start()).toBe(true);
    expect(client.suspend()).toBe(true);
    // Idempotent: nothing is running any more.
    expect(client.suspend()).toBe(false);

    await client.destroy();
    expect(client.resume()).toBe(false);
    expect(client.suspend()).toBe(false);
  });

  it('can retry a failed runtime startup without reconstructing the client', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('client observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      autoStart: false,
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(() => client.start()).toThrow('client observer unavailable');
      globalThis.IntersectionObserver = originalIntersectionObserver;
      expect(client.start()).toBe(true);

      await fireUpdate({ title: 'after retry' });
      expect(document.querySelector('h1')?.textContent).toBe('after retry');
      expect(client.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      await client.destroy();
    }
  });

  it('can retry after a deferred DOM-ready startup fails behind the client start flag', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('deferred client observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      autoStart: false,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    const startupErrors: string[] = [];
    client.events.on('error', ({ error, context }) => {
      if (context === 'startup') startupErrors.push(error.message);
    });

    try {
      expect(client.start()).toBe(true);
      readyState.mockReturnValue('interactive');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await Promise.resolve();

      expect(startupErrors).toEqual(['deferred client observer unavailable']);

      globalThis.IntersectionObserver = originalIntersectionObserver;
      // The client remembers the first successful scheduling call, but the
      // runtime rolled its failed deferred transaction back. Calling start()
      // again must therefore retry the runtime rather than report a dead start.
      expect(client.start()).toBe(true);
      await fireUpdate({ title: 'after deferred retry' });

      expect(document.querySelector('h1')?.textContent).toBe('after deferred retry');
      expect(client.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      readyState.mockRestore();
      await client.destroy();
    }
  });

  it('boots, connects, and renders a text update', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({ type: 'payload-live-preview', data: { title: 'new title' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('new title');
    expect(client.status).toBe('connected');
    expect(client.updateCount).toBe(1);
    await client.destroy();
  });

  it('keeps the debug client operational when console.debug throws', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {
      throw new Error('console unavailable');
    });
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debug: true,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await fireUpdate({ title: 'new title' });

      expect(document.querySelector('h1')?.textContent).toBe('new title');
      expect(client.updateCount).toBe(1);
    } finally {
      debug.mockRestore();
      await client.destroy();
    }
  });

  it('renders Lexical rich text into a richText field', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext></div>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      data: {
        body: {
          root: {
            children: [
              { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Hello' }] },
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'world', format: 1 }],
              },
            ],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    const body = document.querySelector('[data-payload-field="body"]');
    expect(body?.innerHTML).toContain('<h2>Hello</h2>');
    expect(body?.innerHTML).toContain('<strong>world</strong>');
    await client.destroy();
  });

  it('rejects updates from untrusted origins', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage(
      { type: 'payload-live-preview', data: { title: 'evil' } },
      'https://evil.example.com',
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('old');
    expect(client.status).toBe('disconnected');
    await client.destroy();
  });

  it('renders an image field', async () => {
    document.body.innerHTML = '<img data-payload-field="hero" alt="">';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      data: { hero: { url: 'https://cdn.example.com/x.jpg', alt: 'a' } },
    });
    await vi.advanceTimersByTimeAsync(50);
    const img = document.querySelector('img')!;
    expect(img.src).toBe('https://cdn.example.com/x.jpg');
    expect(img.alt).toBe('a');
    await client.destroy();
  });

  it('applies structural updates before afterUpdate and never defers DOM work past destroy', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<li>{{label}}</li>"></ul>';
    let transitionWork: (() => void) | undefined;
    const startViewTransition = vi.fn((work: () => void) => {
      transitionWork = work;
      return { finished: Promise.resolve() };
    });
    Reflect.set(document, 'startViewTransition', startViewTransition);
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    let domAtAfterUpdate: string | undefined;
    client.events.on('afterUpdate', () => {
      domAtAfterUpdate = document.querySelector('ul')?.textContent ?? undefined;
    });

    try {
      await fireUpdate({ items: [{ id: 'a', label: 'applied' }] });

      expect(document.querySelector('ul')?.textContent).toBe('applied');
      expect(domAtAfterUpdate).toBe('applied');
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(transitionWork).toBeUndefined();
      await client.destroy();
      const container = document.querySelector('ul');
      if (container === null) throw new Error('structural container missing');
      container.replaceChildren(document.createTextNode('consumer state after destroy'));

      expect(transitionWork).toBeUndefined();
      expect(container.textContent).toBe('consumer state after destroy');
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
      await client.destroy();
    }
  });

  it.each([
    ['missing template', ''],
    [
      'sanitized template without an element root',
      ' data-payload-array-template="<script>{{label}}</script>"',
    ],
  ])('does not emit afterUpdate for a structural %s no-op', async (_label, templateAttribute) => {
    document.body.innerHTML = `<ul data-payload-field="items" data-payload-structural${templateAttribute}></ul>`;
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ items: [{ id: 'a', label: 'not applied' }] });

      expect(document.querySelector('ul')?.children).toHaveLength(0);
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('keeps existing structural DOM intact when a changed item has no renderable root', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<script>{{label}}</script>">' +
      '<li data-payload-key="old">server state</li></ul>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ items: [{ id: 'new', label: 'cannot render' }] });

      const container = document.querySelector('ul');
      expect(container?.children).toHaveLength(1);
      expect(container?.firstElementChild?.getAttribute('data-payload-key')).toBe('old');
      expect(container?.textContent).toBe('server state');
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('does not emit another afterUpdate for unchanged structural DOM', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<li>{{label}}</li>"></ul>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);
    const items = [{ id: 'a', label: 'applied once' }];

    try {
      await fireUpdate({ items });
      expect(afterUpdate).toHaveBeenCalledOnce();
      afterUpdate.mockClear();

      await fireUpdate({ items: [{ id: 'a', label: 'applied once' }] });

      expect(document.querySelector('ul')?.textContent).toBe('applied once');
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it.each([
    {
      label: 'text renderer protecting structured children',
      markup: '<div data-payload-field="value" data-payload-type="text"><span>seed</span></div>',
      value: 'replacement',
    },
    {
      label: 'array renderer receiving a non-array value',
      markup: '<div data-payload-field="value" data-payload-type="array">seed</div>',
      value: 'not an array',
    },
    {
      label: 'image renderer receiving no safe URL',
      markup: '<img data-payload-field="value" data-payload-type="image" src="/before.jpg">',
      value: { url: 'javascript:alert(1)' },
    },
    {
      label: 'upload renderer receiving no safe media URL',
      markup: '<img data-payload-field="value" data-payload-type="upload" src="/before.jpg">',
      value: { url: 'javascript:alert(1)', filename: 'unsafe' },
    },
    {
      label: 'rich-text renderer receiving an unsupported value',
      markup: '<div data-payload-field="value" data-payload-type="richText">seed</div>',
      value: { unsupported: true },
    },
  ])('does not emit afterUpdate for $label', async ({ markup, value }) => {
    document.body.innerHTML = markup;
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ value });

      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('ignores a custom renderer false return after a real DOM write', async () => {
    document.body.innerHTML = '<div data-payload-field="value" data-payload-type="text"></div>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    await client.use({
      name: 'boolean-returning-renderer',
      init: (context) => {
        context.registerFieldRenderer({
          name: 'text',
          // toggleAttribute returns false while removing a present attribute.
          // The public void contract has always ignored this incidental value.
          render: (target) => target.element.toggleAttribute('data-before', false),
        });
      },
    });
    const element = document.querySelector('[data-payload-field="value"]');
    if (element === null) throw new Error('binding missing');
    element.setAttribute('data-before', '');
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    client.events.on('elementUpdate', elementUpdate);
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ value: 'applied' });

      expect(element.hasAttribute('data-before')).toBe(false);
      expect(elementUpdate).toHaveBeenCalledOnce();
      expect(afterUpdate).toHaveBeenCalledWith(expect.objectContaining({ updatedCount: 1 }));
    } finally {
      await client.destroy();
    }
  });

  it('honours a plugin renderer override', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    await client.use({
      name: 'upper',
      init: (ctx) => {
        ctx.registerFieldRenderer({
          name: 'text',
          render: (target, value) => {
            target.element.textContent = String(value).toUpperCase();
          },
        });
      },
    });
    fireMessage({ type: 'payload-live-preview', data: { title: 'hello' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('HELLO');
    await client.destroy();
  });

  it('dispatches revision-bound transformed values through renderer and attribute paths', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old</p>' +
      '<span data-payload-field="label" data-payload-attribute="data-label"></span>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await client.use({
        name: 'transform-both-paths',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `rendered:${String(value)}`);
          ctx.registerTransform('label', (value) => `attribute:${String(value)}`);
        },
      });

      await fireUpdate({ title: 'raw title', label: 'raw label' });

      expect(document.querySelector('p')?.textContent).toBe('rendered:raw title');
      expect(document.querySelector('span')?.getAttribute('data-label')).toBe(
        'attribute:raw label',
      );
    } finally {
      await client.destroy();
    }
  });

  it('passes merged values through transforms while allFields stays the merged snapshot', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old</p><span data-payload-field="sibling"></span>';
    const mergedFields = {
      id: 'post-1',
      title: 'merged title',
      sibling: 'merged sibling',
    };
    const mergeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mergedFields), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      serverURL: 'https://cms.example.com',
      mergeFetch: mergeFetch as typeof fetch,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    let seenValue: unknown;
    let seenAllFields: Record<string, unknown> | undefined;
    try {
      await client.use({
        name: 'merged-transform-contract',
        init: (ctx) => {
          ctx.registerTransform('title', (value, context) => {
            seenValue = value;
            seenAllFields = context.allFields;
            return `${String(value)} transformed`;
          });
        },
      });

      fireMessage({
        type: 'payload-live-preview',
        collectionSlug: 'posts',
        data: { id: 'post-1', title: 'raw title', sibling: 'raw sibling' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(mergeFetch).toHaveBeenCalledOnce();
      expect(seenValue).toBe('merged title');
      expect(seenAllFields).toEqual(mergedFields);
      expect(seenAllFields?.['title']).toBe('merged title');
      expect(document.querySelector('p')?.textContent).toBe('merged title transformed');
    } finally {
      await client.destroy();
    }
  });

  it('does not let a transform bypass URL validation on an attribute binding', async () => {
    document.body.innerHTML =
      '<a data-payload-field="destination" data-payload-attribute="href" href="/initial">link</a>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await client.use({
        name: 'unsafe-url-transform',
        init: (ctx) => {
          ctx.registerTransform('destination', () => 'javascript:alert(1)');
        },
      });

      await fireUpdate({ destination: '/incoming-safe-path' });

      expect(document.querySelector('a')?.getAttribute('href')).toBe('/initial');
    } finally {
      await client.destroy();
    }
  });

  it('reports the first flush the visibility gate holds back, once', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      visibilityGateThreshold: 0,
    });
    try {
      await fireUpdate({ title: 'first' });
      // Held back: the element is offscreen and the gate is on.
      expect(element.textContent).toBe('initial');
      const gateWarnings = (): string[] =>
        warn.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => message.includes('visibility gate held'));
      expect(gateWarnings()).toHaveLength(1);
      expect(gateWarnings()[0]).toContain('visibilityGateThreshold');

      // A second deferral must not repeat it: a warning that fires per flush
      // during typing is noise, and noise is why this cliff went unnoticed.
      await fireUpdate({ title: 'second' });
      expect(gateWarnings()).toHaveLength(1);

      IO.latest?.setVisible(element, true);
      await Promise.resolve();
      expect(element.textContent).toBe('second');
    } finally {
      await client.destroy();
      warn.mockRestore();
    }
  });

  it('freezes transformed values before an offscreen revision enters replay', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      visibilityGateThreshold: 0,
    });
    try {
      await fireUpdate({ title: 'revision value' });
      expect(element.textContent).toBe('initial');

      await client.use({
        name: 'late-transform',
        init: (ctx) => {
          ctx.registerTransform('title', (value) => `late:${String(value)}`);
        },
      });
      IO.latest?.setVisible(element, true);
      await Promise.resolve();

      expect(element.textContent).toBe('revision value');
    } finally {
      await client.destroy();
    }
  });

  it('stops obsolete transform callbacks and diagnostics after synchronous re-entry', async () => {
    document.body.innerHTML =
      '<p data-payload-field="first">initial first</p>' +
      '<p data-payload-field="second">initial second</p>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transforms: string[] = [];
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await client.use({
        name: 'reentrant-transform',
        init: (ctx) => {
          ctx.registerTransform('first', (value) => {
            transforms.push(`first:${String(value)}`);
            if (value === 'A first') {
              fireMessage({
                type: 'payload-live-preview',
                data: { first: 'B first', second: 'B second' },
              });
            }
            return value;
          });
          ctx.registerTransform('first', (value) => {
            transforms.push(`first-tail:${String(value)}`);
            return value;
          });
          ctx.registerTransform('second', (value) => {
            transforms.push(`second:${String(value)}`);
            return value;
          });
        },
      });

      fireMessage({
        type: 'payload-live-preview',
        data: { first: 'A first', second: 'A second', orphanA: 'must not diagnose' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(transforms).toEqual([
        'first:A first',
        'first:B first',
        'first-tail:B first',
        'second:B second',
      ]);
      expect(warn).not.toHaveBeenCalled();
      expect(document.querySelector('[data-payload-field="first"]')?.textContent).toBe('B first');
      expect(document.querySelector('[data-payload-field="second"]')?.textContent).toBe('B second');
    } finally {
      warn.mockRestore();
      await client.destroy();
    }
  });

  it('reports throwing and thenable transforms and applies the original value', async () => {
    document.body.innerHTML =
      '<p data-payload-field="throws">old</p><p data-payload-field="async">old</p>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const errors: { error: Error; context: string }[] = [];
    client.events.on('error', (event) => {
      errors.push(event);
    });
    try {
      await client.use({
        name: 'invalid-transforms',
        init: (ctx) => {
          ctx.registerTransform('throws', () => {
            throw new Error('transform exploded');
          });
          ctx.registerTransform('async', () => Promise.resolve('too late'));
        },
      });

      await fireUpdate({ throws: 'safe throw fallback', async: 'safe async fallback' });

      expect(document.querySelector('[data-payload-field="throws"]')?.textContent).toBe(
        'safe throw fallback',
      );
      expect(document.querySelector('[data-payload-field="async"]')?.textContent).toBe(
        'safe async fallback',
      );
      expect(errors).toHaveLength(2);
      expect(errors.every((entry) => entry.context === 'transform')).toBe(true);
    } finally {
      await client.destroy();
    }
  });

  it('restores the previous renderer layer and then the built-in renderer on unuse', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await client.use({
        name: 'renderer-a',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `A:${String(value)}`;
            },
          });
        },
      });
      await client.use({
        name: 'renderer-b',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `B:${String(value)}`;
            },
          });
        },
      });

      await fireUpdate({ title: 'first' });
      expect(document.querySelector('p')?.textContent).toBe('B:first');

      await client.unuse('renderer-b');
      await fireUpdate({ title: 'second' });
      expect(document.querySelector('p')?.textContent).toBe('A:second');

      await client.unuse('renderer-a');
      await fireUpdate({ title: 'third' });
      expect(document.querySelector('p')?.textContent).toBe('third');
    } finally {
      await client.destroy();
    }
  });

  it('keeps the top renderer active when a lower renderer layer is removed', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    try {
      await client.use({
        name: 'lower-renderer',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `lower:${String(value)}`;
            },
          });
        },
      });
      await client.use({
        name: 'top-renderer',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `top:${String(value)}`;
            },
          });
        },
      });

      await client.unuse('lower-renderer');
      await fireUpdate({ title: 'still top' });
      expect(document.querySelector('p')?.textContent).toBe('top:still top');

      await client.unuse('top-renderer');
      await fireUpdate({ title: 'built in' });
      expect(document.querySelector('p')?.textContent).toBe('built in');
    } finally {
      await client.destroy();
    }
  });

  it('emits lifecycle events to consumer subscribers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const seen: string[] = [];
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const push = (name: string) => () => {
      seen.push(name);
    };
    client.events.on('init', push('init'));
    client.events.on('connect', push('connect'));
    client.events.on('afterUpdate', push('afterUpdate'));
    fireMessage({ type: 'payload-live-preview', data: { title: 'y' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toContain('connect');
    expect(seen).toContain('afterUpdate');
    await client.destroy();
  });

  it('per-instance isolation — destroying one does not affect another', async () => {
    document.body.innerHTML = '<p data-payload-field="a">x</p><p data-payload-field="b">y</p>';
    const c1 = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const c2 = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const seen1: string[] = [];
    const seen2: string[] = [];
    c1.events.on('connect', () => {
      seen1.push('c1');
    });
    c2.events.on('connect', () => {
      seen2.push('c2');
    });
    await c1.destroy();
    fireMessage({ type: 'payload-live-preview', data: { a: '1', b: '2' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(seen2).toContain('c2');
    await c2.destroy();
  });

  it('keeps the shared accessibility region alive for a surviving client', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const c1 = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const c2 = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });

    try {
      await fireUpdate({ title: 'first' });
      const region = document.getElementById('payload-live-preview-a11y');
      expect(region).not.toBeNull();

      await c1.destroy();
      expect(document.getElementById('payload-live-preview-a11y')).toBe(region);

      await fireUpdate({ title: 'second' });
      expect(region?.textContent).toBe('1 change applied');
    } finally {
      await c1.destroy();
      await c2.destroy();
    }

    expect(document.getElementById('payload-live-preview-a11y')).toBeNull();
  });

  it('destroy is idempotent and clears state', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    await client.destroy();
    await client.destroy();
    expect(client.destroyed).toBe(true);
  });

  it('shares one in-flight destroy promise across concurrent callers', async () => {
    const releaseDestroy = deferred<undefined>();
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    await client.use({
      name: 'slow-destroy',
      init: () => undefined,
      destroy: () => releaseDestroy.promise,
    });

    const firstDestroy = client.destroy();
    const secondDestroy = client.destroy();
    expect(secondDestroy).toBe(firstDestroy);
    let firstSettled = false;
    let secondSettled = false;
    const first = firstDestroy.then(() => {
      firstSettled = true;
    });
    const second = secondDestroy.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    releaseDestroy.resolve(undefined);
    await Promise.all([first, second]);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
  });

  it('lets a plugin destroy hook await client.unuse for another plugin', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    const destroyStarted = deferred<undefined>();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await client.use({
      name: 'client-destroy-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = client.unuse('client-destroy-b');
        destroyStarted.resolve(undefined);
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await client.use({
      name: 'client-destroy-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
      },
    });

    const destruction = client.destroy();
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested client.unuse was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await destruction;

    expect(calls).toEqual(['a:start', 'b', 'a:end']);
    expect(client.plugins).toEqual([]);
  });

  it('lets plugin init await client.unuse for its own pending registration', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    const initStarted = deferred<undefined>();
    let selfRemoval: Promise<void> | undefined;
    const registration = client.use({
      name: 'client-self-removing-init',
      init: async () => {
        selfRemoval = client.unuse('client-self-removing-init');
        initStarted.resolve(undefined);
        await selfRemoval;
      },
    });
    await initStarted.promise;
    if (selfRemoval === undefined) throw new Error('self-removing client.unuse was not started');

    expect(await settlesWithinMicrotaskDrain(selfRemoval)).toBe(true);
    await registration;
    expect(client.plugins).toEqual([]);
    await client.destroy();
  });

  it('lets plugin init await client.use for another plugin', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    const initStarted = deferred<undefined>();
    let nestedUse: Promise<void> | undefined;
    const registration = client.use({
      name: 'client-registering-init',
      init: async () => {
        nestedUse = client.use({ name: 'client-nested-init', init: () => undefined });
        initStarted.resolve(undefined);
        await nestedUse;
      },
    });
    await initStarted.promise;
    if (nestedUse === undefined) throw new Error('nested client.use was not started');

    expect(await settlesWithinMicrotaskDrain(nestedUse)).toBe(true);
    await registration;
    expect(client.plugins).toEqual(['client-nested-init', 'client-registering-init']);
    await client.destroy();
  });

  it('lets plugin destroy await client.use for another plugin during unuse', async () => {
    const client = new LivePreviewClient({
      // Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip.
      defaults: 'v1',
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    const destroyStarted = deferred<undefined>();
    let nestedUse: Promise<void> | undefined;
    await client.use({
      name: 'client-registering-destroy',
      init: () => undefined,
      destroy: async () => {
        nestedUse = client.use({ name: 'client-nested-destroy', init: () => undefined });
        destroyStarted.resolve(undefined);
        await nestedUse;
      },
    });

    const removal = client.unuse('client-registering-destroy');
    await destroyStarted.promise;
    if (nestedUse === undefined) throw new Error('nested client.use was not started');
    expect(await settlesWithinMicrotaskDrain(nestedUse)).toBe(true);
    await removal;

    expect(client.plugins).toEqual(['client-nested-destroy']);
    await client.destroy();
  });
});
