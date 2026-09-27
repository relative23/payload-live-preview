/**
 * These requests cross each framework's real HTTP server before they reach the
 * shared fragment endpoint. An oversized body must be refused before preview
 * authorization, with the same private response contract on every adapter.
 */
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

const OVERSIZED_FIELD = '界'.repeat(30_000);

async function postOversizedFragment(
  request: APIRequestContext,
  origin: string,
  route: string,
): Promise<APIResponse> {
  return request.post(`${origin}/payload/fragment`, {
    headers: { 'content-type': 'application/json', origin },
    data: {
      fragment: 'hero',
      route,
      search: '',
      revision: 1,
      globalSlug: 'home',
      fields: { title: 'Oversized preview', body: OVERSIZED_FIELD },
    },
  });
}

async function expectBodyRefusal(response: APIResponse): Promise<void> {
  expect(response.status()).toBe(413);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-payload-fragment-version']).toBe('1');
  expect(await response.json()).toEqual({ error: 'body' });
}

interface NativeHttpResponse {
  readonly status: number | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function postChunkedFragment(origin: string, route: string): Promise<NativeHttpResponse> {
  const url = new URL('/payload/fragment', origin);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      fragment: 'hero',
      route,
      search: '',
      revision: 1,
      globalSlug: 'home',
      fields: { title: 'Oversized preview', body: OVERSIZED_FIELD },
    }),
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    let ended = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = (): void => {
      for (const timer of timers) clearTimeout(timer);
    };
    const pending = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'transfer-encoding': 'chunked',
        },
      },
      (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          settled = true;
          clearTimers();
          if (!ended) {
            ended = true;
            pending.end();
          }
          resolve({ status: response.statusCode, headers: response.headers, body });
        });
      },
    );
    pending.setTimeout(5_000, () => {
      pending.destroy(new Error('chunked fragment request timed out'));
    });
    pending.on('error', (error) => {
      clearTimers();
      if (!settled) reject(error);
    });
    // Cross the cap while the final chunk is still withheld. A bridge that
    // destroys its incoming request on Web-stream cancellation cannot hide
    // behind a body the client had already finished uploading.
    pending.write(bytes.slice(0, 40_000));
    timers.push(
      setTimeout(() => {
        pending.write(bytes.slice(40_000, 80_000));
      }, 20),
      setTimeout(() => {
        ended = true;
        pending.end(bytes.slice(80_000));
      }, 200),
    );
  });
}

function expectNativeBodyRefusal(response: NativeHttpResponse): void {
  expect(response.status).toBe(413);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['x-payload-fragment-version']).toBe('1');
  expect(response.body).toBe('{"error":"body"}');
}

test.describe('fragment request body bounds over HTTP', () => {
  test('Astro refuses an oversized multibyte fragment request', async ({ request }) => {
    await expectBodyRefusal(
      await postOversizedFragment(request, 'http://localhost:4177', '/bench'),
    );
  });

  test('Next.js refuses an oversized multibyte fragment request', async ({ request }) => {
    await expectBodyRefusal(
      await postOversizedFragment(request, 'http://localhost:4174', '/hybrid'),
    );
  });

  test('SvelteKit refuses an oversized multibyte fragment request', async ({ request }) => {
    await expectBodyRefusal(
      await postOversizedFragment(request, 'http://localhost:4175', '/hybrid'),
    );
  });

  test('Nuxt refuses an oversized multibyte fragment request', async ({ request }) => {
    await expectBodyRefusal(
      await postOversizedFragment(request, 'http://localhost:4176', '/hybrid'),
    );
  });

  test('Astro refuses an oversized chunked fragment request', async () => {
    expectNativeBodyRefusal(await postChunkedFragment('http://localhost:4177', '/bench'));
  });

  test('Next.js refuses an oversized chunked fragment request', async () => {
    expectNativeBodyRefusal(await postChunkedFragment('http://localhost:4174', '/hybrid'));
  });

  test('SvelteKit refuses an oversized chunked fragment request', async () => {
    expectNativeBodyRefusal(await postChunkedFragment('http://localhost:4175', '/hybrid'));
  });

  test('Nuxt refuses an oversized chunked fragment request', async () => {
    expectNativeBodyRefusal(await postChunkedFragment('http://localhost:4176', '/hybrid'));
  });
});
