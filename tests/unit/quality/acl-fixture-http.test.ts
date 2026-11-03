import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { serveFixtureRequest } from '../../../examples/payload-backend/fixture-http';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = undefined;
});

/** One chunk now and the rest only after two seconds, as a slow read streams. */
function slowResponse(): Response {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first chunk'));
        timer = setTimeout(() => controller.close(), 2_000);
      },
      cancel() {
        clearTimeout(timer);
      },
    }),
    { status: 200 },
  );
}

/** A fixture server that answers `/quick` at once and every other path slowly. */
async function streamingServer(served: Promise<void>[]): Promise<number> {
  const listening = createServer((incoming, outgoing) => {
    served.push(
      serveFixtureRequest(incoming, outgoing, (_request, url) =>
        Promise.resolve(url.pathname === '/quick' ? new Response('ok') : slowResponse()),
      ),
    );
  });
  server = listening;
  await new Promise<void>((done) => listening.listen(0, '127.0.0.1', done));
  return (listening.address() as AddressInfo).port;
}

describe('the ACL fixture HTTP edge', () => {
  // The owner spec's newer revision aborts the older read while its body streams: in WebKit
  // that once made the fixture write a 500 over headers it had sent, which threw in the worker.
  it('lets a client go away mid-response without throwing, and keeps answering', async () => {
    const served: Promise<void>[] = [];
    const port = await streamingServer(served);
    await new Promise<void>((done) => {
      const call = request({ port, host: '127.0.0.1', path: '/slow' }, (response) => {
        expect(response.statusCode).toBe(200);
        response.once('data', () => {
          call.destroy();
          done();
        });
      });
      call.on('error', () => undefined);
      call.end();
    });
    await expect(Promise.all(served)).resolves.toBeDefined();
    const status = await new Promise<number | undefined>((done) => {
      request({ port, host: '127.0.0.1', path: '/quick' }, (response) => {
        response.resume();
        done(response.statusCode);
      }).end();
    });
    expect(status).toBe(200);
  });
});
