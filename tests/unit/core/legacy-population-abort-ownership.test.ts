/**
 * A pending native body owns its cancellation subscription and reader lock.
 * Cancelling the producer releases that subscription before invoking its hook,
 * while the caller's observer remains owned by the caller.
 */
import { getEventListeners } from 'node:events';
import { ReadableStream as NativeReadableStream } from 'node:stream/web';
import { transferableAbortController } from 'node:util';
import { describe, expect, it } from 'vitest';
import { populationBody } from '@core/legacy-population';

describe('legacy population — abort subscription ownership', () => {
  it('releases its native abort subscription before the producer cancellation hook', async () => {
    const owner = transferableAbortController();
    const observed: Event[] = [];
    const observer = (event: Event) => {
      observed.push(event);
    };
    owner.signal.addEventListener('abort', observer);
    let beginReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      beginReading = resolve;
    });
    let listenersDuringCancellation: unknown[] | undefined;
    const stream = new NativeReadableStream<Uint8Array>(
      {
        pull() {
          beginReading();
        },
        cancel() {
          listenersDuringCancellation = getEventListeners(owner.signal, 'abort');
        },
      },
      { highWaterMark: 0 },
    );
    const pending = populationBody(
      new Response(stream as unknown as ReadableStream<Uint8Array>),
      owner.signal,
      () => true,
    );
    const settled = pending.then(
      () => 'resolved',
      () => 'refused',
    );
    try {
      await reading;
      expect(stream.locked).toBe(true);
      expect(getEventListeners(owner.signal, 'abort')).toContain(observer);
      owner.abort();
      expect(listenersDuringCancellation).toEqual([observer]);
      expect(observed[0]?.target).toBe(owner.signal);
      await expect(settled).resolves.toBe('refused');
      expect(stream.locked).toBe(false);
      expect(getEventListeners(owner.signal, 'abort')).toEqual([observer]);
    } finally {
      owner.abort();
      await settled;
      owner.signal.removeEventListener('abort', observer);
    }
    expect(getEventListeners(owner.signal, 'abort')).toEqual([]);
  });

  it('refuses with its own error when an abort listener fires on a signal that is not aborted', async () => {
    // A hand-built or relayed signal can run its abort listeners while `aborted` is still false;
    // the pending read ends as the module's refusal, not as a TypeError from a missing chunk.
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as AbortSignal;
    let beginReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      beginReading = resolve;
    });
    let cancelled = 0;
    const stream = new NativeReadableStream<Uint8Array>(
      {
        pull() {
          beginReading();
        },
        cancel() {
          cancelled += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const settled = populationBody(
      new Response(stream as unknown as ReadableStream<Uint8Array>),
      signal,
      () => true,
    ).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await reading;
    for (const listener of listeners) listener();
    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('invalid or oversized legacy population');
    expect(cancelled).toBe(1);
    expect(listeners.size).toBe(0);
  });

  it('refuses instead of resolving the interruption marker when a json-only response is pending', async () => {
    // An injected shim without a body has nothing to cancel: the interruption alone ends the wait, and it must end
    // as the module's refusal like the stream branch does, never as the marker handed back as the parsed value.
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as AbortSignal;
    const response = {
      body: null,
      json: () => new Promise<unknown>(() => undefined),
    } as unknown as Response;
    const settled = populationBody(response, signal, () => true).then(
      (value: unknown) => ({ resolved: value }),
      (error: unknown) => error,
    );
    await Promise.resolve();
    await Promise.resolve();
    for (const listener of listeners) listener();
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('invalid or oversized legacy population');
    expect(listeners.size).toBe(0);
  });
});
