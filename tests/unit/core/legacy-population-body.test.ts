/**
 * Native response bytes and reader callbacks remain owned by one population
 * attempt. Finite byte boundaries and real pending-read cancellation preserve
 * exact decoded values while releasing the reader and abort listener.
 */
import { ReadableStream as NativeReadableStream } from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';
import { populationBody } from '@core/legacy-population';

function finite(chunks: readonly Uint8Array[]) {
  let pulls = 0;
  const cancel = vi.fn();
  const stream = new NativeReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[pulls];
        pulls += 1;
        if (chunk === undefined) controller.close();
        else {
          controller.enqueue(chunk);
          if (pulls === chunks.length) controller.close();
        }
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const response = new Response(stream as unknown as ReadableStream<Uint8Array>);
  return { response, stream, cancel, pulls: () => pulls };
}

const encoded = (text: string) => new TextEncoder().encode(text);
function byteChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < bytes.byteLength; index += 16_384) {
    chunks.push(bytes.slice(index, index + 16_384));
  }
  return chunks;
}

describe('legacy population — native body bytes and decoding', () => {
  it('preserves valid Unicode even when each UTF8 byte arrives in a separate chunk', async () => {
    const value = { docs: [{ id: 'A', name: 'Ada ä😀', text: 'line\nquote"' }] };
    const bytes = encoded(JSON.stringify(value));
    const body = finite([...bytes].map((byte) => Uint8Array.of(byte)));
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    await expect(populationBody(body.response, owner.signal, () => true)).resolves.toEqual(value);
    expect(body.pulls()).toBe(bytes.byteLength);
    expect(body.cancel).not.toHaveBeenCalled();
    expect(body.stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
  });

  it('accepts exactly one MiB of native JSON and releases its finished reader without cancellation', async () => {
    const overhead = encoded(JSON.stringify({ docs: [{ id: 'A', name: '' }] })).byteLength;
    const name = 'a'.repeat(1_048_576 - overhead);
    const value = { docs: [{ id: 'A', name }] };
    const bytes = encoded(JSON.stringify(value));
    expect(bytes.byteLength).toBe(1_048_576);
    const body = finite(byteChunks(bytes));
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    await expect(populationBody(body.response, owner.signal, () => true)).resolves.toEqual(value);
    expect(body.pulls()).toBe(64);
    expect(body.cancel).not.toHaveBeenCalled();
    expect(body.stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
  });

  it('refuses one byte above the native ceiling and releases a still-open producer', async () => {
    const overhead = encoded(JSON.stringify({ docs: [{ id: 'A', name: '' }] })).byteLength;
    const bytes = encoded(
      JSON.stringify({ docs: [{ id: 'A', name: 'a'.repeat(1_048_577 - overhead) }] }),
    );
    expect(bytes.byteLength).toBe(1_048_577);
    let pulls = 0;
    const cancel = vi.fn();
    const chunks = byteChunks(bytes);
    const stream = new NativeReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[pulls];
          pulls += 1;
          if (chunk !== undefined) controller.enqueue(chunk);
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    await expect(
      populationBody(
        new Response(stream as unknown as ReadableStream<Uint8Array>),
        owner.signal,
        () => true,
      ),
    ).rejects.toThrow();
    expect(pulls).toBe(65);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    expect(owner.signal.aborted).toBe(false);
  });

  it('does not call a native reader cancellation callback after successful completion', async () => {
    const value = { docs: [{ id: 'A', name: 'Ada' }] };
    const body = finite([encoded(JSON.stringify(value))]);
    const reader = body.stream.getReader();
    const cancel = vi.spyOn(reader, 'cancel');
    const response = { body: { getReader: () => reader } } as unknown as Response;
    const owner = new AbortController();
    await expect(populationBody(response, owner.signal, () => true)).resolves.toEqual(value);
    expect(cancel).not.toHaveBeenCalled();
    expect(body.stream.locked).toBe(false);
  });

  it.each(['{', '{"docs":', 'not JSON'])(
    'refuses a completed invalid JSON body %j and still unlocks it',
    async (text) => {
      const body = finite([encoded(text)]);
      const owner = new AbortController();
      const add = vi.spyOn(owner.signal, 'addEventListener');
      const remove = vi.spyOn(owner.signal, 'removeEventListener');
      await expect(populationBody(body.response, owner.signal, () => true)).rejects.toThrow();
      expect(body.stream.locked).toBe(false);
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    },
  );
});

describe('legacy population — caller ownership and injected response shims', () => {
  it.each(['aborted', 'obsolete'] as const)(
    'does not touch a response body for an already %s owner',
    async (mode) => {
      const owner = new AbortController();
      if (mode === 'aborted') owner.abort();
      const body = vi.fn(() => null);
      const json = vi.fn().mockResolvedValue({ docs: [{ id: 'A' }] });
      const response = {
        get body() {
          return body();
        },
        json,
      } as unknown as Response;
      const add = vi.spyOn(owner.signal, 'addEventListener');
      const remove = vi.spyOn(owner.signal, 'removeEventListener');
      await expect(
        populationBody(response, owner.signal, () => mode !== 'obsolete'),
      ).rejects.toThrow();
      expect(body).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    },
  );

  it('accepts a json-only shim with its actual receiver and removes the abort listener', async () => {
    const value = { docs: [{ id: 'A', name: 'Ada' }] };
    const json = vi.fn(function (this: unknown) {
      expect(this).toBe(response);
      return Promise.resolve(value);
    });
    const response = { body: null, json } as unknown as Response;
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    await expect(populationBody(response, owner.signal, () => true)).resolves.toEqual(value);
    expect(json).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
  });

  it('does not invoke a json getter result after that getter revokes the owner', async () => {
    let current = true;
    const json = vi.fn().mockResolvedValue({ docs: [{ id: 'A' }] });
    const response = {
      body: null,
      get json() {
        current = false;
        return json;
      },
    } as unknown as Response;
    const owner = new AbortController();
    await expect(populationBody(response, owner.signal, () => current)).rejects.toThrow();
    expect(json).not.toHaveBeenCalled();
  });

  it('interrupts a held json-only promise on abort without waiting for the shim', async () => {
    let finish: (value: unknown) => void = () => {
      throw new Error('missing held response');
    };
    const json = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    const pending = populationBody(
      { body: null, json } as unknown as Response,
      owner.signal,
      () => true,
    );
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    try {
      owner.abort();
      await expect(pending).rejects.toThrow();
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    } finally {
      owner.abort();
      finish({ docs: [{ id: 'A' }] });
      await pending.catch(() => undefined);
    }
  });

  it('releases a held native read even when cancellation rejects and the reader ignores abort', async () => {
    let finish: (value: ReadableStreamReadResult<Uint8Array>) => void = () => {
      throw new Error('missing held read');
    };
    const read = vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          finish = resolve;
        }),
    );
    const cancel = vi.fn().mockRejectedValue(new Error('host cancellation failed'));
    const releaseLock = vi.fn();
    const reader = { read, cancel, releaseLock };
    const response = { body: { getReader: () => reader } } as unknown as Response;
    const owner = new AbortController();
    const add = vi.spyOn(owner.signal, 'addEventListener');
    const remove = vi.spyOn(owner.signal, 'removeEventListener');
    const pending = populationBody(response, owner.signal, () => true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    try {
      owner.abort();
      await expect(pending).rejects.toThrow();
      owner.abort();
      expect(cancel).toHaveBeenCalledOnce();
      expect(releaseLock).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    } finally {
      owner.abort();
      finish({ done: true, value: undefined });
      await pending.catch(() => undefined);
    }
  });

  it('does not invoke a read getter result after that getter revokes its owner', async () => {
    let current = true;
    const read = vi.fn().mockResolvedValue({ done: true });
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const reader = {
      get read() {
        current = false;
        return read;
      },
      cancel,
      releaseLock,
    };
    const response = { body: { getReader: () => reader } } as unknown as Response;
    const owner = new AbortController();
    await expect(populationBody(response, owner.signal, () => current)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('keeps refusal authoritative when host cancellation and lock release both throw', async () => {
    const cancel = vi.fn(() => {
      throw new Error('host cancel');
    });
    const releaseLock = vi.fn(() => {
      throw new Error('host unlock');
    });
    const reader = { read: vi.fn().mockRejectedValue(new Error('host read')), cancel, releaseLock };
    const response = { body: { getReader: () => reader } } as unknown as Response;
    const owner = new AbortController();
    await expect(populationBody(response, owner.signal, () => true)).rejects.toThrow('host read');
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
