/**
 * The draft read carries the editor's session, so it reads only where `serverURL`
 * points and never follows a redirect. It asks for that with `redirect: 'manual'`
 * and reports the 3xx answer as an HTTP failure: workerd rejects `'error'` before
 * it sends anything, so a read asking for it failed on every request there.
 */
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { definePreview, type PreviewFetchFunction } from '@/server/index';

const DOCS = JSON.stringify({ docs: [{ id: 'from-the-redirect-target' }] });

/** workerd's refusal, word for word (src/workerd/api/http.c++). */
const WORKERD_REDIRECT_REFUSAL =
  'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be ' +
  'implemented since it does not make sense at the edge; use "manual" and check the ' +
  'response status code).';

/** A fetch that checks `redirect` as workerd does before sending, then answers one document. */
const workerdFetch: PreviewFetchFunction = (_url, init) => {
  const mode: string = init.redirect;
  if (mode !== 'follow' && mode !== 'manual') {
    return Promise.reject(new TypeError(WORKERD_REDIRECT_REFUSAL));
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ docs: [{ id: 'page-1' }] }),
  });
};

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => {
            done();
          });
        }),
    ),
  );
});

async function serve(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

/** A server that answers documents to anyone, counting who asked. */
async function docsServer(): Promise<{ readonly origin: string; readonly hits: () => number }> {
  let hits = 0;
  const origin = await serve((_incoming, outgoing) => {
    hits += 1;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.end(DOCS);
  });
  return { origin, hits: () => hits };
}

describe('definePreview and redirects', () => {
  it("reads the document through a fetch that refuses redirect: 'error', as workerd's does", async () => {
    const preview = definePreview({
      serverURL: 'https://cms.example.com',
      depth: 1,
      fetch: workerdFetch,
    });

    const result = await preview.fetchDocument({ collection: 'pages', authorization: null });

    expect(result).toEqual({ ok: true, data: { id: 'page-1' }, draft: false, status: 200 });
  });

  it('reports a redirect to another origin as an HTTP failure with its status, and never asks there', async () => {
    const target = await docsServer();
    const cms = await serve((_incoming, outgoing) => {
      outgoing.writeHead(302, { location: `${target.origin}/api/pages` });
      outgoing.end();
    });

    const result = await definePreview({ serverURL: cms, depth: 1 }).fetchDocument({
      collection: 'pages',
      authorization: null,
    });

    expect(result).toMatchObject({ ok: false, reason: 'http', status: 302 });
    expect(target.hits()).toBe(0);
  });

  it('reports a redirect within the same origin the same way', async () => {
    let redirected = 0;
    const cms = await serve((incoming, outgoing) => {
      if (incoming.url?.startsWith('/moved/') === true) {
        redirected += 1;
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(DOCS);
        return;
      }
      outgoing.writeHead(301, { location: `/moved${incoming.url ?? '/'}` });
      outgoing.end();
    });

    const result = await definePreview({ serverURL: cms, depth: 1 }).fetchDocument({
      collection: 'pages',
      authorization: null,
    });

    expect(result).toMatchObject({ ok: false, reason: 'http', status: 301 });
    expect(redirected).toBe(0);
  });
});
