/**
 * The native host routes borrow Node's body without an eager H3 body buffer.
 * Cancellation stops reading but does not destroy the response socket; an
 * unread body instead closes keep-alive after the refusal is sent.
 */
import type { IncomingMessage } from 'node:http';

export async function withNativeHostRequest(
  incoming: IncomingMessage,
  url: URL,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  let stopped = false;
  let wake: (() => void) | undefined;
  const abort = (): void => {
    controller.abort();
    wake?.();
  };
  incoming.pause();
  incoming.socket.on('close', abort);
  incoming.on('error', abort);
  if (incoming.socket.destroyed || (incoming.destroyed && !incoming.complete)) abort();
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    headers.append(incoming.rawHeaders[i]!, incoming.rawHeaders[i + 1]!);
  }
  const method = incoming.method ?? 'GET';
  let finished = method === 'GET' || method === 'HEAD';
  const release = (): void => {
    stopped = true;
    incoming.pause();
    wake?.();
  };
  const waiting = (): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        incoming.removeListener('readable', done);
        incoming.removeListener('end', done);
        wake = undefined;
        resolve();
      };
      wake = done;
      incoming.once('readable', done);
      incoming.once('end', done);
      if (stopped || controller.signal.aborted || incoming.readableEnded) done();
    });
  const body = finished
    ? null
    : new ReadableStream<Uint8Array>(
        {
          async pull(target) {
            while (!stopped) {
              if (controller.signal.aborted) {
                target.error(new Error('Native host request aborted'));
                return;
              }
              const chunk: unknown = incoming.read();
              if (chunk !== null) {
                if (!Buffer.isBuffer(chunk)) throw new Error('Expected native byte body');
                target.enqueue(chunk);
                return;
              }
              if (incoming.readableEnded) {
                finished = true;
                target.close();
                return;
              }
              await waiting();
            }
          },
          cancel: release,
        },
        { highWaterMark: 0 },
      );
  try {
    const request = new Request(url, {
      method,
      headers,
      signal: controller.signal,
      ...(body ? { body, duplex: 'half' } : {}),
    });
    const response = await handler(request);
    if (finished) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('connection', 'close');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } finally {
    release();
    incoming.socket.removeListener('close', abort);
    incoming.removeListener('error', abort);
  }
}
