/**
 * Schema-driven field-type resolution.
 *
 * Verifies the killer feature: when the consumer's DOM doesn't carry
 * a `data-payload-type` attribute AND Payload sends `fieldSchemaJSON`
 * along with the data, the runtime auto-routes to the renderer that
 * matches the schema's declared type.
 *
 * Without this wiring the only way to render a Lexical rich-text
 * field was to add `data-payload-richtext` manually. With it the
 * preview "just works" against any annotated container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';

class IO implements IntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
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
}

const TRUSTED = 'https://admin.example.com';

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

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  fakeIframe();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('schema-driven field-type resolution', () => {
  it('routes a richText field to the rich-text renderer via schema, without data-payload-richtext', async () => {
    // Note: the <div> has neither data-payload-type nor
    // data-payload-richtext — pure data-payload-field.
    document.body.innerHTML = '<div data-payload-field="body"></div>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'body', type: 'richText' }],
      data: {
        body: {
          root: {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Hello from Lexical' }],
              },
            ],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    const body = document.querySelector('[data-payload-field="body"]');
    expect(body?.innerHTML).toContain('<p>Hello from Lexical</p>');
    await client.destroy();
  });

  it('schema upload type drives the upload renderer when the DOM has only data-payload-field', async () => {
    document.body.innerHTML = '<img data-payload-field="hero" alt="">';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'hero', type: 'upload' }],
      data: { hero: { url: 'https://cdn.example.com/x.jpg', alt: 'caption' } },
    });
    await vi.advanceTimersByTimeAsync(50);
    const img = document.querySelector('img');
    expect(img?.src).toBe('https://cdn.example.com/x.jpg');
    expect(img?.alt).toBe('caption');
    await client.destroy();
  });

  it('schema relationship type drives the relationship renderer', async () => {
    document.body.innerHTML = '<span data-payload-field="author"></span>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'author', type: 'relationship' }],
      data: { author: { title: 'Jane Doe' } },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('[data-payload-field="author"]')?.textContent).toBe('Jane Doe');
    await client.destroy();
  });

  it('schema number type drives Intl.NumberFormat rendering', async () => {
    document.body.innerHTML = '<span data-payload-field="price"></span>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'price', type: 'number' }],
      data: { price: 1234.5 },
      locale: 'en-US',
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('[data-payload-field="price"]')?.textContent).toMatch(/1[.,]234/);
    await client.destroy();
  });

  it('explicit data-payload-type wins over schema (consumer override)', async () => {
    // The DOM says "text" but schema says "richText" — DOM wins.
    document.body.innerHTML = '<div data-payload-field="body" data-payload-type="text"></div>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'body', type: 'richText' }],
      data: {
        body: {
          root: {
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'plain' }] }],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    const body = document.querySelector('[data-payload-field="body"]');
    // The text renderer flattens Lexical to plain text — no <p> tag.
    expect(body?.innerHTML).not.toContain('<p>');
    expect(body?.textContent).toBe('plain');
    await client.destroy();
  });

  it('falls back to the cache-resolved type when no schema arrives', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      // No fieldSchemaJSON; runtime falls back to the cache's tag heuristic.
      data: { title: 'new' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('new');
    await client.destroy();
  });

  it('walks nested schema paths (group → child)', async () => {
    document.body.innerHTML = '<p data-payload-field="hero.subtitle"></p>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [
        {
          name: 'hero',
          type: 'group',
          fields: [{ name: 'subtitle', type: 'text' }],
        },
      ],
      data: { hero: { subtitle: 'Subhead from schema walk' } },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('Subhead from schema walk');
    await client.destroy();
  });

  it('keeps the schema across updates that omit it (sticky)', async () => {
    document.body.innerHTML = '<div data-payload-field="body"></div>';
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    fireMessage({
      type: 'payload-live-preview',
      fieldSchemaJSON: [{ name: 'body', type: 'richText' }],
      data: {
        body: {
          root: {
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'first' }] }],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    // Second message has no schema — runtime should still know that
    // body is richText from the prior update.
    fireMessage({
      type: 'payload-live-preview',
      data: {
        body: {
          root: {
            children: [{ type: 'paragraph', children: [{ type: 'text', text: 'second' }] }],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    const body = document.querySelector('[data-payload-field="body"]');
    expect(body?.innerHTML).toContain('<p>second</p>');
    await client.destroy();
  });
});
