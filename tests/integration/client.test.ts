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

describe('LivePreviewClient — end-to-end', () => {
  it('boots, connects, and renders a text update', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient({
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

  it('renders Lexical rich text into a richText field', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-richtext></div>';
    const client = new LivePreviewClient({
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

  it('honours plugins (custom renderer for unknown field type via transform)', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient({
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

  it('emits lifecycle events to consumer subscribers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const seen: string[] = [];
    const client = new LivePreviewClient({
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
      allowedOrigins: [TRUSTED],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    const c2 = new LivePreviewClient({
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

  it('destroy is idempotent and clears state', async () => {
    const client = new LivePreviewClient({
      allowedOrigins: [TRUSTED],
      heartbeatMs: 10 * 60_000,
    });
    await client.destroy();
    await client.destroy();
    expect(client.destroyed).toBe(true);
  });
});
