/**
 * A byte ceiling does not bound work when a native stream keeps yielding empty
 * chunks. Finite producers pin both that boundary and reader/listener cleanup.
 */
import { ReadableStream as NativeReadableStream } from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';
import { populationBody } from '@core/legacy-population';

function finiteBody(
  prefixChunks: number,
  prefix: string,
): {
  response: Response;
  stream: NativeReadableStream<Uint8Array>;
  pulls(): number;
  cancel: ReturnType<typeof vi.fn>;
} {
  let count = 0;
  const cancel = vi.fn();
  const encoder = new TextEncoder();
  const stream = new NativeReadableStream<Uint8Array>(
    {
      pull(controller) {
        count += 1;
        if (count <= prefixChunks) {
          controller.enqueue(encoder.encode(prefix));
        } else {
          controller.enqueue(encoder.encode('{"docs":[{"id":"A"}]}'));
          controller.close();
        }
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  // Node and DOM declarations differ; Response still owns this exact native stream.
  const response = new Response(stream as unknown as ReadableStream<Uint8Array>);
  expect(response.body).toBe(stream);
  return {
    response,
    stream,
    pulls: () => count,
    cancel,
  };
}

describe('legacy population — native stream work', () => {
  it.each(['', ' '])(
    'refuses too many finite chunks, including %j, below the byte limit',
    async (prefix) => {
      const body = finiteBody(10_001, prefix);
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      await expect(populationBody(body.response, controller.signal, () => true)).rejects.toThrow(
        'invalid or oversized legacy population',
      );
      expect(body.pulls()).toBeLessThanOrEqual(10_001);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
      expect(add).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
      expect(controller.signal.aborted).toBe(false);
    },
  );

  it('accepts valid JSON at the finite work boundary and releases its reader', async () => {
    const body = finiteBody(9_999, '');
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(populationBody(body.response, controller.signal, () => true)).resolves.toEqual({
      docs: [{ id: 'A' }],
    });
    expect(body.pulls()).toBe(10_000);
    expect(body.cancel).not.toHaveBeenCalled();
    expect(body.stream.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
  });
});
