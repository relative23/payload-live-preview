/**
 * Loopback HTTP through the continuation reference and a local REST fixture.
 * The DocumentSession bridge checks last-good/recovery only: it intentionally
 * reads saved data, does not populate posted form values, and is not a public merge protocol.
 */
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import { createReferenceContinuation } from '../fixtures/preview-continuation';
import { createReferenceDataHandler } from '../fixtures/preview-continuation-data';
import { continuationHarness, CONTINUATION_SITE } from '../fixtures/preview-continuation-harness';

async function fixture() {
  const h = continuationHarness();
  let base = '';
  const target = { ...h.target };
  const reference = createReferenceContinuation({ ...h.options, binding: () => target });
  const data = createReferenceDataHandler(reference, { fetch });
  const calls: { path: string; verifiedUser: boolean; method: string; arbitraryHeader: boolean }[] =
    [];
  const failures: string[] = [];
  let body: unknown = { id: 'post-a', title: 'First draft', errors: ['A document field'] };
  let status = 200;
  let redirect = false;
  let foreignCalls = 0;
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', CONTINUATION_SITE);
      if (url.pathname === '/foreign') {
        foreignCalls += 1;
        outgoing.end('must not be fetched');
        return;
      }
      if (url.pathname.startsWith('/cms/')) {
        calls.push({
          path: `${url.pathname}${url.search}`,
          verifiedUser: incoming.headers.cookie === h.principal.payloadHeaders['cookie'],
          method: incoming.method ?? '',
          arbitraryHeader: incoming.headers['x-arbitrary'] !== undefined,
        });
        outgoing.writeHead(redirect ? 307 : status, {
          'content-type': 'application/json',
          ...(redirect ? { location: `${base}/foreign` } : {}),
        });
        outgoing.end(JSON.stringify(body));
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      // The public origin is fixed deployment input, not forwarded client data.
      const request = new Request(url, { method: incoming.method ?? 'GET', headers });
      const response = url.searchParams.has('previewToken')
        ? await reference.exchange(request)
        : await data(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    })().catch(() => {
      failures.push('fixture request failed');
      outgoing.writeHead(500);
      outgoing.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture address');
  base = `http://127.0.0.1:${address.port}`;
  target.serverURL = `${base}/cms`;
  return {
    h,
    calls,
    failures,
    foreignCalls: () => foreignCalls,
    set: (next: unknown, code = 200, moved = false) => {
      body = next;
      status = code;
      redirect = moved;
    },
    request: (path: string, init: RequestInit = {}) =>
      fetch(`${base}${path}`, { ...init, redirect: 'manual' }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}

async function login(s: Awaited<ReturnType<typeof fixture>>) {
  const entry = await s.request(`/page?locale=de&previewToken=${await s.h.token()}`, {
    headers: { cookie: s.h.loginCookie },
  });
  expect(entry.status).toBe(303);
  return `${s.h.loginCookie}; ${entry.headers.get('set-cookie')!.split(';')[0]!}`;
}

/** Test bridge only; production direct REST continues to consume raw documents. */
async function unwrap(response: Response): Promise<Response> {
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(null, { status: response.status });
  }
  const envelope: unknown = await response.json();
  if (envelope === null || typeof envelope !== 'object') throw new Error('Invalid data envelope');
  const value = envelope as Record<string, unknown>;
  if (
    value['version'] !== 1 ||
    value['ok'] !== true ||
    Object.hasOwn(value, 'error') ||
    value['data'] === null ||
    typeof value['data'] !== 'object' ||
    Array.isArray(value['data'])
  ) {
    throw new Error('Invalid data envelope');
  }
  return Response.json(value['data']);
}

describe('continuation data over local HTTP', () => {
  it('reads with the verified user, refuses a redirect and recovers without another entry', async () => {
    const s = await fixture();
    try {
      const cookie = await login(s);
      const read = () =>
        s.request('/page?preview=true&locale=de', {
          headers: { cookie, 'x-arbitrary': 'do-not-forward' },
        });
      const first = await read();
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('private, no-store');
      expect(first.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await first.json()).toEqual({
        version: 1,
        ok: true,
        data: { id: 'post-a', title: 'First draft', errors: ['A document field'] },
      });
      s.set({ errors: ['private upstream detail'] }, 200, true);
      const moved = await read();
      expect(moved.status).toBe(502);
      expect(await moved.json()).toEqual({ version: 1, ok: false, error: 'unavailable' });
      expect(s.foreignCalls()).toBe(0);
      s.set({ id: 'post-a', title: 'Recovered draft' });
      expect(await (await read()).json()).toMatchObject({
        ok: true,
        data: { title: 'Recovered draft' },
      });
      expect(s.calls).toEqual(
        Array.from({ length: 3 }, () => ({
          path: '/cms/api/posts/post-a?depth=1&draft=true&locale=de',
          verifiedUser: true,
          method: 'GET',
          arbitraryHeader: false,
        })),
      );
      s.h.records.clear();
      expect((await read()).status).toBe(403);
      expect(s.calls).toHaveLength(3);
      expect(s.h.consumed.size).toBe(1);
      expect(s.failures).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it('preserves the real document-session snapshot on refusals and recovers after a fresh read', async () => {
    const s = await fixture();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const target = frame.contentWindow!;
    let stop: (() => void) | undefined;
    try {
      const cookie = await login(s);
      const initial = { id: 'post-a', title: 'Initial' };
      let requests = 0;
      const session = new DocumentSession(initial, {
        target,
        serverURL: CONTINUATION_SITE,
        allowedOrigins: [CONTINUATION_SITE],
        fetchFn: async (_input, init) => {
          requests += 1;
          return unwrap(
            await s.request('/page?preview=true&locale=de', {
              headers: { cookie },
              ...(init?.signal == null ? {} : { signal: init.signal }),
            }),
          );
        },
      });
      stop = session.subscribe(() => {});
      const update = async () => {
        const previous = requests;
        target.dispatchEvent(
          new MessageEvent('message', {
            origin: CONTINUATION_SITE,
            // Vitest's global window proxy is not this iframe's actual parent.
            source: target.parent,
            data: {
              type: 'payload-live-preview',
              collectionSlug: 'posts',
              locale: 'de',
              data: { id: 'post-a' },
            },
          }),
        );
        expect(requests).toBe(previous + 1);
        await vi.waitFor(() => {
          expect(session.getSnapshot().isLoading).toBe(false);
        });
        return session.getSnapshot();
      };
      const first = await update();
      expect(first.status).toBe('live');
      expect(first.data.title).toBe('First draft');
      for (const code of [401, 403, 429, 500, 200]) {
        s.set({ errors: ['private upstream detail'] }, code);
        const failed = await update();
        expect(failed.status).toBe('unavailable');
        expect(failed.data).toBe(first.data);
        expect(failed.error?.message).not.toContain('private upstream detail');
      }
      s.set({ id: 'post-a', title: 'Recovered draft', errors: [] });
      const recovered = await update();
      expect(recovered.status).toBe('live');
      expect(recovered.data.title).toBe('Recovered draft');
      expect(recovered.error).toBeUndefined();
      s.h.records.clear();
      const revoked = await update();
      expect(revoked.status).toBe('unavailable');
      expect(revoked.data).toBe(recovered.data);
      expect(s.calls).toHaveLength(7);
      expect(s.h.consumed.size).toBe(1);
      expect(s.failures).toEqual([]);
    } finally {
      stop?.();
      frame.remove();
      await s.close();
    }
  });
});
