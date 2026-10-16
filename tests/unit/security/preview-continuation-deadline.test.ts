/**
 * One request deadline across the application-side continuation reference.
 * Dependencies deliberately ignore cancellation, commit before losing their
 * acknowledgement, or settle late; none may authorize a later phase.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePreviewRequest } from '@security/preview-authorization';
import { createReferenceContinuation } from '../../fixtures/preview-continuation';
import { continuationHarness } from '../../fixtures/preview-continuation-harness';

type Operation = 'exchange' | 'authorize';
type Phase = 'principal' | 'binding' | 'verification' | 'consume' | 'publish' | 'read';
const PHASES: readonly [Operation, Phase][] = [
  ['exchange', 'principal'],
  ['exchange', 'binding'],
  ['exchange', 'verification'],
  ['exchange', 'consume'],
  ['exchange', 'publish'],
  ['authorize', 'principal'],
  ['authorize', 'binding'],
  ['authorize', 'read'],
  ['authorize', 'verification'],
];

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function scenario(operation: Operation, phase?: Phase, commitFirst = false) {
  const h = continuationHarness();
  const entry = h.request(`/page?locale=de&previewToken=${await h.token()}`);
  let original = entry;
  if (operation === 'authorize') {
    const opened = await h.reference.exchange(entry);
    expect(opened.status).toBe(303);
    original = h.request(
      undefined,
      `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`,
    );
    h.store.consume.mockClear();
    h.store.publish.mockClear();
  }
  const controller = new AbortController();
  const request = new Request(original, { signal: controller.signal });
  const added = vi.spyOn(request.signal, 'addEventListener');
  const removed = vi.spyOn(request.signal, 'removeEventListener');
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  const seen: { phase: Phase; signal: AbortSignal | undefined }[] = [];
  async function step<T>(
    name: Phase,
    signal: AbortSignal | undefined,
    work: () => T | PromiseLike<T>,
  ): Promise<T> {
    seen.push({ phase: name, signal });
    if (name !== phase) return work();
    try {
      const committed = commitFirst ? await work() : undefined;
      entered.resolve();
      await release.promise;
      return commitFirst ? committed! : await work();
    } finally {
      finished.resolve();
    }
  }
  const reference = createReferenceContinuation({
    ...h.options,
    ...{ totalTimeoutMs: 100 },
    principal: (req) => step('principal', req.signal, () => h.options.principal(req)),
    binding: (principal, req) =>
      step('binding', req.signal, () => h.options.binding(principal, req)),
    authorizeRequest: (req, strategy) =>
      step('verification', req.signal, () => authorizePreviewRequest(req, strategy)),
    store: {
      consume: (id: string, expiry: number, signal?: AbortSignal) =>
        step('consume', signal, () => h.store.consume(id, expiry)),
      publish: (key, record, signal?: AbortSignal) =>
        step('publish', signal, () => h.store.publish(key, record)),
      read: (key, signal?: AbortSignal) => step('read', signal, () => h.store.read(key)),
    },
  });
  return {
    h,
    reference,
    request,
    original,
    controller,
    added,
    removed,
    seen,
    entered,
    release,
    finished,
    start: () => reference[operation](request),
  };
}

function fakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('continuation reference request lifetime', () => {
  it.each(PHASES)(
    '%s refuses a stalled %s at one deadline, before late success',
    async (operation, phase) => {
      const s = await scenario(operation, phase);
      fakeClock();
      let done = false;
      const pending = s.start().then((result) => {
        done = true;
        return result;
      });
      await s.entered.promise;
      try {
        await vi.advanceTimersByTimeAsync(99);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
        const result = await pending;
        if (result instanceof Response) {
          expect(result.status).toBe(403);
          expect(result.headers.has('set-cookie')).toBe(false);
          expect(result.headers.get('cache-control')).toBe('private, no-store');
          expect(await result.text()).toBe('');
        } else expect(result).toBeNull();
        const calls = s.seen.map((entry) => entry.phase);
        expect(s.seen.every((entry) => entry.signal === s.seen[0]!.signal)).toBe(true);
        expect(s.seen[0]!.signal?.aborted).toBe(true);
        s.release.resolve();
        await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(s.seen.map((entry) => entry.phase)).toEqual(calls);
        expect(vi.getTimerCount()).toBe(0);
        expect(s.added).toHaveBeenCalledTimes(1);
        expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it.each(PHASES)(
    '%s aborts promptly during %s without waiting for the dependency',
    async (operation, phase) => {
      const s = await scenario(operation, phase);
      fakeClock();
      let done = false;
      const pending = s.start().then((result) => {
        done = true;
        return result;
      });
      await s.entered.promise;
      try {
        s.controller.abort(new Error('private transport detail'));
        await vi.advanceTimersByTimeAsync(0);
        expect(done).toBe(true);
        const result = await pending;
        if (result instanceof Response) {
          expect(result.status).toBe(403);
          expect(result.headers.has('set-cookie')).toBe(false);
          expect(await result.text()).toBe('');
        } else expect(result).toBeNull();
        expect(s.seen[0]!.signal?.aborted).toBe(true);
        expect(s.seen[0]!.signal?.reason).not.toBe(s.controller.signal.reason);
        expect(vi.getTimerCount()).toBe(0);
        s.release.reject(new Error('late private backend detail'));
        await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(s.h.store.publish).not.toHaveBeenCalled();
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it.each([
    ['consume', 'deadline'],
    ['consume', 'abort'],
    ['publish', 'deadline'],
    ['publish', 'abort'],
  ] as const)(
    'does not restore proof after %s commits and %s loses acknowledgement',
    async (phase, stop) => {
      const s = await scenario('exchange', phase, true);
      fakeClock();
      let done = false;
      const pending = s.start().then((result) => {
        done = true;
        return result;
      });
      await s.entered.promise;
      try {
        expect(s.h.consumed.size).toBe(1);
        if (stop === 'abort') s.controller.abort();
        await vi.advanceTimersByTimeAsync(stop === 'abort' ? 0 : 100);
        expect(done).toBe(true);
        const response = await pending;
        expect(response).toBeInstanceOf(Response);
        expect((response as Response).status).toBe(403);
        expect((response as Response).headers.has('set-cookie')).toBe(false);
        expect((await s.h.reference.exchange(s.original)).status).toBe(403);
        expect(s.h.records.size).toBe(phase === 'publish' ? 1 : 0);
        const entries = [...s.h.records];
        s.release.resolve();
        await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect([...s.h.records]).toEqual(entries);
        expect(s.h.consumed.size).toBe(1);
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it.each(['exchange', 'authorize'] as const)(
    'never starts login for an already-aborted %s',
    async (operation) => {
      const s = await scenario(operation);
      fakeClock();
      s.controller.abort();
      const result = await s.start();
      expect(result instanceof Response ? result.status : result).toBe(
        operation === 'exchange' ? 403 : null,
      );
      expect(s.seen).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['exchange', 'authorize'] as const)(
    'shares one cooperative signal and cleans a successful %s',
    async (operation) => {
      const s = await scenario(operation);
      fakeClock();
      const result = await s.start();
      expect(result instanceof Response ? result.status : result?.context.subject).toBe(
        operation === 'exchange' ? 303 : 'editor-a',
      );
      expect(s.seen.every((entry) => entry.signal === s.seen[0]!.signal)).toBe(true);
      expect(s.seen[0]!.signal).toBeInstanceOf(AbortSignal);
      expect(s.seen[0]!.signal).not.toBe(s.request.signal);
      expect(vi.getTimerCount()).toBe(0);
      expect(s.added).toHaveBeenCalledTimes(1);
      expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
    },
  );

  it('does not reset the deadline between login and mapping', async () => {
    const h = continuationHarness();
    const entry = h.request(`/page?locale=de&previewToken=${await h.token()}`);
    const reference = createReferenceContinuation({
      ...h.options,
      ...{ totalTimeoutMs: 100 },
      principal: () => new Promise((resolve) => setTimeout(() => resolve(h.principal), 60)),
      binding: () => new Promise((resolve) => setTimeout(() => resolve(h.target), 60)),
    });
    fakeClock();
    let done = false;
    const pending = reference.exchange(entry).then((result) => {
      done = true;
      return result;
    });
    try {
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect((await pending).status).toBe(403);
    } finally {
      await vi.advanceTimersByTimeAsync(120);
      await pending;
    }
    expect(h.store.consume).not.toHaveBeenCalled();
    expect(h.store.publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks elapsed monotonic time before an overdue timer callback can run', async () => {
    const h = continuationHarness();
    const entry = h.request(`/page?locale=de&previewToken=${await h.token()}`);
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const binding = vi.fn(h.options.binding);
    const reference = createReferenceContinuation({
      ...h.options,
      ...{ totalTimeoutMs: 100 },
      principal: () => {
        elapsed = 100;
        return h.principal;
      },
      binding,
    });
    expect((await reference.exchange(entry)).status).toBe(403);
    expect(binding).not.toHaveBeenCalled();
    expect(h.store.consume).not.toHaveBeenCalled();
  });

  it.each(['consume', 'publish'] as const)(
    'does not begin %s if the preceding phase aborts',
    async (phase) => {
      const h = continuationHarness();
      const controller = new AbortController();
      const entry = new Request(h.request(`/page?locale=de&previewToken=${await h.token()}`), {
        signal: controller.signal,
      });
      const reference = createReferenceContinuation({
        ...h.options,
        authorizeRequest: (request, strategy) => {
          if (phase !== 'consume' || strategy.type !== 'signed-token') {
            return authorizePreviewRequest(request, strategy);
          }
          const crypto = strategy.crypto!;
          return authorizePreviewRequest(request, {
            ...strategy,
            crypto: {
              getRandomValues: (array) => crypto.getRandomValues(array),
              subtle: {
                importKey: (...args) => crypto.subtle.importKey(...args),
                sign: (...args) => crypto.subtle.sign(...args),
                verify: async (...args) => {
                  const valid = await crypto.subtle.verify(...args);
                  controller.abort();
                  return valid;
                },
              },
            },
          });
        },
        store: {
          ...h.store,
          consume: (id, expiry) => {
            const first = h.store.consume(id, expiry);
            if (phase === 'publish') controller.abort();
            return first;
          },
        },
      });
      const response = await reference.exchange(entry);
      expect(response.status).toBe(403);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(h.store.consume).toHaveBeenCalledTimes(phase === 'consume' ? 0 : 1);
      expect(h.store.publish).not.toHaveBeenCalled();
    },
  );

  it('refuses a principal that resolves successfully in response to cancellation', async () => {
    const h = continuationHarness();
    const entry = h.request(`/page?locale=de&previewToken=${await h.token()}`);
    const binding = vi.fn(h.options.binding);
    const reference = createReferenceContinuation({
      ...h.options,
      totalTimeoutMs: 100,
      principal: (request) =>
        new Promise((resolve) => {
          request.signal!.addEventListener('abort', () => resolve(h.principal), { once: true });
        }),
      binding,
    });
    fakeClock();
    let done = false;
    const pending = reference.exchange(entry).then((value) => {
      done = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
    expect((await pending).status).toBe(403);
    expect(binding).not.toHaveBeenCalled();
    expect(h.store.consume).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not cancel an independent request or let an expired one publish later', async () => {
    const h = continuationHarness();
    const slow = h.request(`/page?locale=de&previewToken=${await h.token()}`);
    slow.headers.set('x-fixture-stall', 'true');
    const fast = h.request(`/page?locale=de&previewToken=${await h.token()}`);
    const release = deferred();
    const signals: AbortSignal[] = [];
    const reference = createReferenceContinuation({
      ...h.options,
      totalTimeoutMs: 100,
      principal: async (request) => {
        signals.push(request.signal!);
        if (request.headers.get('x-fixture-stall') === 'true') await release.promise;
        return h.options.principal(request);
      },
    });
    fakeClock();
    let done = false;
    const pending = reference.exchange(slow).then((value) => {
      done = true;
      return value;
    });
    try {
      await vi.advanceTimersByTimeAsync(50);
      const response = await reference.exchange(fast);
      expect(response.status).toBe(303);
      expect(signals[0]).not.toBe(signals[1]);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(50);
      expect(done).toBe(true);
      expect((await pending).status).toBe(403);
      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);
      release.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.consumed.size).toBe(1);
      expect(h.records.size).toBe(1);
      const cookie = `${h.loginCookie}; ${response.headers.get('set-cookie')!.split(';')[0]!}`;
      // Adapter-shaped requests need not have an incoming AbortSignal.
      const request = h.request(undefined, cookie);
      expect(
        (await reference.authorize({ url: request.url, headers: request.headers }))?.context
          .subject,
      ).toBe('editor-a');
      expect(h.store.publish).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      release.resolve();
      await pending;
    }
  });

  it.each(['exchange', 'authorize'] as const)(
    'cleans listeners and timers after %s dependency rejection',
    async (operation) => {
      const s = await scenario(operation, 'principal');
      fakeClock();
      const pending = s.start();
      await s.entered.promise;
      s.release.reject(new Error('private backend detail'));
      const result = await pending;
      expect(result instanceof Response ? result.status : result).toBe(
        operation === 'exchange' ? 503 : null,
      );
      if (result instanceof Response) expect(await result.text()).toBe('');
      expect(vi.getTimerCount()).toBe(0);
      expect(s.added).toHaveBeenCalledTimes(1);
      expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
      expect(s.h.store.consume).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])(
    'refuses an invalid total deadline: %s',
    (totalTimeoutMs) => {
      const h = continuationHarness();
      expect(() => createReferenceContinuation({ ...h.options, ...{ totalTimeoutMs } })).toThrow();
    },
  );
});
