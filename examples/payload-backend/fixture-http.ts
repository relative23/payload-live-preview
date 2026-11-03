/**
 * The ACL fixture's HTTP edge, kept apart from Payload so a unit test can drive it: read a
 * bounded request body, answer through `handle`, and stream the response back.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export function serveFixtureRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handle: (request: Request, url: URL) => Promise<Response>,
): Promise<void> {
  return (async () => {
    // No client-supplied Host can change the fixture's API origin.
    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = incoming.method ?? 'GET';
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += Buffer.byteLength(chunk);
      if (length > 8192) throw new Error('Fixture request exceeds setup limit');
      chunks.push(Buffer.from(chunk));
    }
    const response = await handle(
      new Request(url, {
        method,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
      url,
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    // Node and DOM declare the same native stream with distinct TS types.
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), outgoing);
    } else outgoing.end();
  })().catch(() => {
    // A client that goes away mid-response (a newer preview revision aborts the older read)
    // ends the stream after the headers went out; only a request that failed before them can
    // still be answered with a 500.
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    outgoing.writeHead(500);
    outgoing.end();
  });
}
