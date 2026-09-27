/**
 * The local Nitro host bridge owns body demand and disconnect listeners.
 * These contracts distinguish a flushed refusal from destroying its socket;
 * the production browser suite exercises the same bundled helper through H3.
 */
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { withNativeHostRequest } from '../../fixtures/preview-native-request';

const URL_VALUE = new URL('https://localhost/continuation/login');
function input(method = 'POST') {
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  request.method = method;
  request.rawHeaders = ['content-type', 'application/json', 'x-test', 'one', 'x-test', 'two'];
  const foreign = vi.fn();
  socket.on('close', foreign);
  return { socket, request, foreign };
}
function clean(value: ReturnType<typeof input>) {
  expect(value.socket.listeners('close')).toEqual([value.foreign]);
  expect(value.request.listenerCount('readable')).toBe(0);
  expect(value.request.listenerCount('end')).toBe(0);
  expect(value.request.listenerCount('error')).toBe(0);
  expect(value.socket.destroyed).toBe(false);
}

describe('native continuation request bridge', () => {
  it('does not acquire an unauthorized body or destroy the response socket', async () => {
    const value = input();
    const read = vi.spyOn(value.request, 'read');
    const response = await withNativeHostRequest(value.request, URL_VALUE, (request) => {
      expect(request.headers.get('x-test')).toBe('one, two');
      return Promise.resolve(new Response(null, { status: 403 }));
    });
    expect(read).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.headers.get('connection')).toBe('close');
    clean(value);
  });
  it('streams a complete body and leaves normal keep-alive unchanged', async () => {
    const value = input();
    // Node's HTTP parser marks a fully received upload before ending its stream.
    value.request.complete = true;
    value.request.push(Buffer.from('{"title":"Unsaved"}'));
    value.request.push(null);
    const response = await withNativeHostRequest(value.request, URL_VALUE, async (request) => {
      expect(await request.json()).toEqual({ title: 'Unsaved' });
      return new Response('done');
    });
    expect(await response.text()).toBe('done');
    expect(response.headers.has('connection')).toBe(false);
    clean(value);
  });
  it('cancels a pending read without cancelling Node or leaving a waiter', async () => {
    const value = input();
    const response = await withNativeHostRequest(value.request, URL_VALUE, async (request) => {
      const reader = request.body!.getReader();
      const pending = reader.read();
      await Promise.resolve();
      await reader.cancel();
      expect(await pending).toEqual({ done: true, value: undefined });
      return new Response(null, { status: 413 });
    });
    expect(response.headers.get('connection')).toBe('close');
    clean(value);
  });
  it('propagates a disconnect after upload only to that request', async () => {
    const first = input('GET');
    const second = input('GET');
    await withNativeHostRequest(first.request, URL_VALUE, async (a) => {
      await withNativeHostRequest(second.request, URL_VALUE, (b) => {
        first.socket.emit('close');
        expect(a.signal.aborted).toBe(true);
        expect(b.signal.aborted).toBe(false);
        return Promise.resolve(new Response());
      });
      return new Response();
    });
    clean(first);
    clean(second);
  });
  it('releases listeners when the handler rejects with an outstanding read', async () => {
    const value = input();
    await expect(
      withNativeHostRequest(value.request, URL_VALUE, async (request) => {
        void request.body!.getReader().read();
        await Promise.resolve();
        throw new Error('test refusal');
      }),
    ).rejects.toThrow('test refusal');
    clean(value);
  });
  it('rejects a stalled body when the native socket closes', async () => {
    const value = input();
    await withNativeHostRequest(value.request, URL_VALUE, async (request) => {
      const body = request.text();
      const rejected = expect(body).rejects.toThrow('Native host request aborted');
      await Promise.resolve();
      value.socket.emit('close');
      await rejected;
      expect(request.signal.aborted).toBe(true);
      return new Response(null, { status: 403 });
    });
    clean(value);
  });
  it('does not mistake an already consumed upload for a disconnected client', async () => {
    const value = input('GET');
    value.request.complete = true;
    value.request.destroyed = true;
    await withNativeHostRequest(value.request, URL_VALUE, (request) => {
      expect(request.signal.aborted).toBe(false);
      return Promise.resolve(new Response());
    });
    clean(value);
  });
});
