/**
 * Real loopback HTTP requests through the ADR 0019 application reference and
 * package endpoint. The configured public HTTPS origin models a trusted proxy;
 * this client does not prove TLS or browser cookie/SameSite enforcement.
 */
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { continuationHarness, CONTINUATION_SITE } from '../fixtures/preview-continuation-harness';
import { createReferenceFragment } from '../fixtures/preview-continuation-fragment';
import {
  createReferenceContinuation,
  type ContinuationOptions,
} from '../fixtures/preview-continuation';

async function httpFixture(
  configure: (
    h: ReturnType<typeof continuationHarness>,
  ) => Partial<ContinuationOptions> = () => ({}),
) {
  const h = continuationHarness();
  const reference = createReferenceContinuation({ ...h.options, ...configure(h) });
  const readProps = vi.fn((input: { fields: Readonly<Record<string, unknown>> }) =>
    Promise.resolve({ title: input.fields['title'] }),
  );
  const fragment = createReferenceFragment(reference, readProps);
  const failures: string[] = [];
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        if (!Buffer.isBuffer(chunk)) throw new Error('fixture bytes');
        size += chunk.byteLength;
        if (size > 65_536) throw new Error('fixture cap');
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      // Never derive the public origin from a client-controlled Forwarded/Host.
      const url = new URL(incoming.url ?? '/', CONTINUATION_SITE);
      const method = incoming.method ?? 'GET';
      const request = new Request(url, {
        method,
        headers,
        ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      });
      let response: Response;
      if (url.pathname === '/payload/fragment') response = await fragment(request);
      else if (url.searchParams.has('previewToken')) response = await reference.exchange(request);
      else {
        const grant = await reference.authorize(request);
        response = new Response(grant === null ? '' : '<main>authorized page</main>', {
          status: grant === null ? 403 : 200,
          headers: {
            'cache-control': 'private, no-store',
            'referrer-policy': 'no-referrer',
            vary: 'Cookie',
          },
        });
      }
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
  return {
    h,
    failures,
    readProps,
    request: (path: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, redirect: 'manual' }),
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

function fragmentBody(revision: number, document = 'post-a') {
  return {
    fragment: 'hero',
    route: '/page',
    search: '?preview=true&locale=de',
    revision,
    locale: 'de',
    collectionSlug: 'posts',
    fields: { id: document, title: `unsaved ${revision}` },
  };
}

describe('continuation over local HTTP', () => {
  it('returns a generic refusal for a committed publication with no acknowledgement', async () => {
    let signal: AbortSignal | undefined;
    const fixture = await httpFixture((h) => ({
      totalTimeoutMs: 1_000,
      store: {
        ...h.store,
        publish: (key, record, lifetime) => {
          signal = lifetime;
          h.store.publish(key, record);
          return new Promise<boolean>(() => {});
        },
      },
    }));
    const { h } = fixture;
    try {
      const path = `/page?locale=de&previewToken=${await h.token()}`;
      const response = await fixture.request(path, { headers: { cookie: h.loginCookie } });
      expect(response.status).toBe(403);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(await response.text()).toBe('');
      expect(signal?.aborted).toBe(true);
      expect(h.records.size).toBe(1);
      expect(h.consumed.size).toBe(1);
      expect((await fixture.request(path, { headers: { cookie: h.loginCookie } })).status).toBe(
        403,
      );
      expect(h.store.publish).toHaveBeenCalledTimes(1);
      expect(fixture.failures).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  it('renders both unsaved revisions, authorizes reload and refuses replay, another document and revocation', async () => {
    const fixture = await httpFixture();
    const { h } = fixture;
    try {
      const token = await h.token();
      const entryPath = `/page?locale=de&previewToken=${token}`;
      const entry = await fixture.request(entryPath, { headers: { cookie: h.loginCookie } });
      expect(entry.status).toBe(303);
      const setCookie = entry.headers.get('set-cookie');
      expect(setCookie !== null).toBe(true);
      const cookie = `${h.loginCookie}; ${setCookie!.split(';')[0]!}`;
      const location = entry.headers.get('location')!;
      expect(location).toBe('/page?preview=true&locale=de');
      const page = await fixture.request(location, { headers: { cookie } });
      expect(page.status).toBe(200);
      expect(await page.text()).toBe('<main>authorized page</main>');
      const headers = { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' };
      for (const revision of [1, 2]) {
        const response = await fixture.request('/payload/fragment', {
          method: 'POST',
          headers,
          body: JSON.stringify(fragmentBody(revision)),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          html: `<h1>UNSAVED ${revision}</h1>`,
          revision,
        });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
      expect(fixture.readProps).toHaveBeenCalledTimes(2);
      const otherDocument = await fixture.request('/payload/fragment', {
        method: 'POST',
        headers,
        body: JSON.stringify(fragmentBody(3, 'private-post')),
      });
      // The package scope gate refuses before the application registry runs.
      expect(otherDocument.status).toBe(403);
      expect(await otherDocument.json()).toEqual({ error: 'unauthorized' });
      expect(fixture.readProps).toHaveBeenCalledTimes(2);
      const reload = await fixture.request(location, { headers: { cookie } });
      expect(reload.status).toBe(200);
      expect(await reload.text()).toBe('<main>authorized page</main>');
      const replay = await fixture.request(entryPath, { headers: { cookie: h.loginCookie } });
      expect(replay.status).toBe(403);
      expect(replay.headers.has('set-cookie')).toBe(false);
      h.records.clear();
      const revoked = await fixture.request('/payload/fragment', {
        method: 'POST',
        headers,
        body: JSON.stringify(fragmentBody(4)),
      });
      expect(revoked.status).toBe(403);
      expect(await revoked.json()).toEqual({ error: 'unauthorized' });
      expect(fixture.readProps).toHaveBeenCalledTimes(2);
      expect(fixture.failures).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
});
