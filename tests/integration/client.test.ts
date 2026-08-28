import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';
import {
  fireMessage,
  fireUpdate,
  preparePreviewPage,
  restorePreviewPage,
  v1Config,
} from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

describe('LivePreviewClient — end-to-end', () => {
  it('boots, connects, and renders a text update', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const client = new LivePreviewClient(v1Config());
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
    const client = new LivePreviewClient(v1Config({ debug: true }));
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
    const client = new LivePreviewClient(v1Config());
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
    const client = new LivePreviewClient(v1Config());
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
    const client = new LivePreviewClient(v1Config());
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

  it('emits lifecycle events to consumer subscribers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const seen: string[] = [];
    const client = new LivePreviewClient(v1Config());
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
    const c1 = new LivePreviewClient(v1Config());
    const c2 = new LivePreviewClient(v1Config());
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
    const c1 = new LivePreviewClient(v1Config());
    const c2 = new LivePreviewClient(v1Config());

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
});
