import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * A merge answer is as large and as deep as Payload makes it: 3.0 gives the
 * merge a deadline and no byte limit. What the runtime owes such an answer is
 * that it walks it without recursion it cannot afford. A document nested a
 * hundred thousand levels deep overflows the stack of any function that
 * descends it call by call.
 */
const PAGE =
  '<h1 data-payload-field="title">old</h1><span data-payload-field="venue.title"></span>';
const answer = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

/** Two answers in a row: the large one, then an ordinary one. */
async function mergeThenMergeAgain(large: string): Promise<{
  afterLarge: string | null | undefined;
  afterNext: string | null | undefined;
  errors: number;
}> {
  document.body.innerHTML = PAGE;
  const answers = [large, '{"id":"post-1","title":"merged after","venue":{"title":"W"}}'];
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(answer(answers.shift() ?? '{}')));
  const emitter = new EventEmitter();
  const errors = vi.fn();
  emitter.on('error', errors);
  const runtime = makeRuntime({
    emitter,
    dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
  });
  runtime.start();

  fireMessage({
    type: 'payload-live-preview',
    collectionSlug: 'posts',
    data: { id: 'post-1', title: 'raw', venue: 3 },
  });
  await vi.advanceTimersByTimeAsync(80);
  const afterLarge = document.querySelector('h1')?.textContent;

  fireMessage({
    type: 'payload-live-preview',
    collectionSlug: 'posts',
    data: { id: 'post-1', title: 'raw again', venue: 4 },
  });
  await vi.advanceTimersByTimeAsync(80);
  const afterNext = document.querySelector('h1')?.textContent;
  runtime.destroy();
  return { afterLarge, afterNext, errors: errors.mock.calls.length };
}

describe('a merge answer that is very deep or very large', () => {
  const DEPTH = 100_000;
  const document42 = (extra: string): string =>
    `{"id":"post-1","title":"merged large","venue":{"title":"V"},${extra}}`;

  it('is applied when arrays nest a hundred thousand levels deep, and the next update too', async () => {
    const deep = `"deep":${'['.repeat(DEPTH)}1${']'.repeat(DEPTH)}`;
    expect(await mergeThenMergeAgain(document42(deep))).toEqual({
      afterLarge: 'merged large',
      afterNext: 'merged after',
      errors: 0,
    });
  });

  it('is applied when objects nest a hundred thousand levels deep, and the next update too', async () => {
    const deep = `"deep":${'{"a":'.repeat(DEPTH)}1${'}'.repeat(DEPTH)}`;
    expect(await mergeThenMergeAgain(document42(deep))).toEqual({
      afterLarge: 'merged large',
      afterNext: 'merged after',
      errors: 0,
    });
  });

  it('is applied when one field holds four megabytes of text', async () => {
    const large = `"body":"${'x'.repeat(4 * 1024 * 1024)}"`;
    expect(await mergeThenMergeAgain(document42(large))).toEqual({
      afterLarge: 'merged large',
      afterNext: 'merged after',
      errors: 0,
    });
  });
});
