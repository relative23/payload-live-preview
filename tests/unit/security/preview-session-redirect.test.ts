/**
 * The session verdict has to come from the endpoint `serverURL` names. Fetch
 * follows a redirect by default: on a hop to another origin it drops the
 * cookie but still reads the answer there, and a user in that answer used to
 * be authorized. A redirect is refused instead, like any answer outside 2xx.
 */
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizePreviewRequest,
  type FetchLike,
  type PreviewAuthorizationRequest,
} from '@security/preview-authorization';

const SITE = 'https://site.example.com';
const USER = JSON.stringify({ user: { id: 'from-the-redirect-target' }, collection: 'users' });

function request(): PreviewAuthorizationRequest {
  return {
    url: `${SITE}/page?preview=true`,
    headers: new Headers({ cookie: 'payload-token=abc.def.ghi' }),
  };
}

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

/** A server that answers a user to anyone, counting who asked. */
async function userServer(): Promise<{ readonly origin: string; readonly hits: () => number }> {
  let hits = 0;
  const origin = await serve((_incoming, outgoing) => {
    hits += 1;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.end(USER);
  });
  return { origin, hits: () => hits };
}

describe('payload-session and redirects', () => {
  it('asks fetch to hand a redirect back instead of following it, on both attempts', async () => {
    // A null user first, so the strategy also makes its retry with the origin.
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ user: null }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ user: { id: 'editor' }, collection: 'users' }),
      });

    const result = await authorizePreviewRequest(request(), {
      type: 'payload-session',
      serverURL: 'https://cms.example.com',
      fetch,
    });

    expect(result.outcome).toBe('authorized');
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect(init.redirect).toBe('manual');
  });

  it('refuses a /me that redirects to another origin, and never asks that origin', async () => {
    const target = await userServer();
    const cms = await serve((_incoming, outgoing) => {
      outgoing.writeHead(302, { location: `${target.origin}/collect` });
      outgoing.end();
    });

    const result = await authorizePreviewRequest(request(), {
      type: 'payload-session',
      serverURL: cms,
    });

    expect(result).toEqual({ authorized: false, outcome: 'unavailable', context: null });
    expect(target.hits()).toBe(0);
  });

  it('refuses a redirect within the same origin too: the strategy reads only the endpoint it was given', async () => {
    let redirected = 0;
    const cms = await serve((incoming, outgoing) => {
      if (incoming.url?.startsWith('/api/users/me/') === true) {
        redirected += 1;
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(USER);
        return;
      }
      outgoing.writeHead(301, { location: '/api/users/me/?depth=0' });
      outgoing.end();
    });

    const result = await authorizePreviewRequest(request(), {
      type: 'payload-session',
      serverURL: cms,
    });

    expect(result).toEqual({ authorized: false, outcome: 'unavailable', context: null });
    expect(redirected).toBe(0);
  });
});
