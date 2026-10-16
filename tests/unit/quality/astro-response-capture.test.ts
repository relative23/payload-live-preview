/**
 * Browser observation must not substitute a response or delay the real client.
 * Failed reads remain visible and excess traffic cannot grow the capture log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureAstroResponses,
  type AstroResponseCapture,
} from '../../e2e/helpers/astro-response-capture';
const original = window.fetch.bind(window);
const records = (): AstroResponseCapture[] =>
  Reflect.get(window, 'astroResourceResponses') as AstroResponseCapture[];
const request = {
  method: 'POST',
  body: JSON.stringify({ fields: { title: 'First unsaved card' } }),
};
afterEach(() => {
  window.fetch = original;
  Reflect.deleteProperty(window, 'astroResourceResponses');
});

describe('native Astro response observation', () => {
  it('returns the original promise and response without consuming the client body', async () => {
    const response = new Response('First unsaved card resource-card');
    const pending = Promise.resolve(response);
    const fetch = vi.fn<typeof window.fetch>(() => pending);
    window.fetch = fetch;
    captureAstroResponses();
    expect(window.fetch('/payload/resource-fragment', request)).toBe(pending);
    expect(fetch.mock.calls[0]?.[1]).toBe(request);
    await vi.waitFor(() => expect(records()[0]?.complete).toBe(true));
    expect(response.bodyUsed).toBe(false);
    expect(await (await pending).text()).toBe('First unsaved card resource-card');
    expect(records()).toEqual([
      { complete: true, status: 200, bytes: 32, hasTitle: true, hasCard: true },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ignores other resources, malformed bodies and revisions', async () => {
    window.fetch = vi.fn(() => Promise.resolve(new Response('untouched')));
    captureAstroResponses();
    await window.fetch('/elsewhere', request);
    await window.fetch('/payload/resource-fragment', { ...request, body: '{}' });
    await window.fetch('/payload/resource-fragment', { ...request, body: 'invalid' });
    expect(records()).toEqual([]);
  });

  it('records failed reads without swallowing the original rejection', async () => {
    const error = new Error('private error detail');
    window.fetch = vi.fn(() => Promise.reject(error));
    captureAstroResponses();
    await expect(window.fetch('/payload/resource-fragment', request)).rejects.toBe(error);
    await vi.waitFor(() => expect(records()).toEqual([{ complete: true, error: true }]));
    const response = new Response(
      new ReadableStream({ start: (controller) => controller.error(error) }),
    );
    const pending = Promise.resolve(response);
    window.fetch = vi.fn(() => pending);
    captureAstroResponses();
    expect(window.fetch('/payload/resource-fragment', request)).toBe(pending);
    await vi.waitFor(() => expect(records()).toEqual([{ complete: true, error: true }]));
    await expect(response.text()).rejects.toBe(error);
  });

  it('retains an overflow verdict without suppressing extra requests', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('content')));
    window.fetch = fetch;
    captureAstroResponses();
    await Promise.all(
      Array.from({ length: 4 }, () => window.fetch('/payload/resource-fragment', request)),
    );
    await vi.waitFor(() => expect(records().every((record) => record.complete)).toBe(true));
    expect(records()).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
