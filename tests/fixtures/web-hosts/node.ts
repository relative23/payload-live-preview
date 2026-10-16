/**
 * A bare Node server turns a native request into a Web request the way the
 * frameworks do. It is the control: whatever it shows is Node's, not the
 * package's. A response that leaves the request body unread closes the
 * connection. Without that, a browser's next request on the same connection is
 * read as the rest of the body and waits (measured: every second 300 kB request
 * in Chromium and Firefox).
 */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import handle from './handler';

const port = Number(process.env['PORT'] ?? '4393');

createServer((req, res) => {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const body =
    req.method === 'GET' || req.method === 'HEAD'
      ? null
      : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
  const request = new Request(
    new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`),
    {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' },
  );
  handle(request).then(
    async (response) => {
      const answer = Object.fromEntries(response.headers);
      if (!req.complete) answer['connection'] = 'close';
      res.writeHead(response.status, answer);
      res.end(Buffer.from(await response.arrayBuffer()));
    },
    () => {
      res.writeHead(500).end();
    },
  );
}).listen(port, '127.0.0.1');
