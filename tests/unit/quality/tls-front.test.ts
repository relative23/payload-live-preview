/**
 * The fixtures' TLS front on loopback, against a plain HTTP upstream: what it forwards, the
 * WebSocket handshake a development server behind it needs, and the certificate it hands to a
 * client that must trust it. The client here trusts only that certificate.
 */
import { readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { request } from 'node:https';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const moduleUrl = pathToFileURL(resolve('scripts/tls-front.mjs')).href;
const { startTlsFront } = (await import(moduleUrl)) as {
  startTlsFront: (options: {
    label: string;
    publicUrl: URL;
    internalPort: number;
    certificateOut?: string;
    adjust?: (incoming: IncomingMessage, response: IncomingMessage) => void;
  }) => { close: () => void };
};

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

const certificateOut = join(tmpdir(), `plp-tls-front-test-${String(process.pid)}.pem`);
let upstream: Server;
let front: { close: () => void };
let port: number;
let ca: Buffer;

beforeAll(async () => {
  upstream = createServer((incoming, outgoing) => {
    outgoing.setHeader('x-dropped', 'by adjust');
    outgoing.end(
      JSON.stringify({
        host: incoming.headers.host,
        proto: incoming.headers['x-forwarded-proto'],
        forwardedHost: incoming.headers['x-forwarded-host'],
        forwardedPort: incoming.headers['x-forwarded-port'],
      }),
    );
  });
  upstream.on('upgrade', (_incoming, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: probe\r\nConnection: Upgrade\r\n\r\n',
    );
    socket.on('data', (data: Buffer) => socket.write(`echo:${data.toString()}`));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  port = await freePort();
  front = startTlsFront({
    label: 'test front',
    publicUrl: new URL(`https://localhost:${String(port)}`),
    internalPort: (upstream.address() as AddressInfo).port,
    certificateOut,
    adjust: (_incoming, response) => {
      delete response.headers['x-dropped'];
    },
  });
  ca = readFileSync(certificateOut);
  // listen() is asynchronous; a request before it would be refused.
  await new Promise((done) => setTimeout(done, 100));
});

afterAll(() => {
  rmSync(certificateOut, { force: true });
  front.close();
  upstream.closeAllConnections();
  upstream.close();
});

describe('the fixtures’ TLS front', () => {
  it('hands out the public certificate only, and a client that trusts it connects', () => {
    const exported = ca.toString('utf8');
    expect(exported).toContain('BEGIN CERTIFICATE');
    expect(exported).not.toContain('PRIVATE KEY');
  });

  it('forwards a request as HTTPS from its public host, with the adjusted headers', async () => {
    const response = await new Promise<{ headers: IncomingMessage['headers']; body: string }>(
      (done, fail) => {
        request(`https://localhost:${String(port)}/path`, { ca }, (incoming) => {
          let body = '';
          incoming.on('data', (chunk: Buffer) => (body += chunk.toString()));
          incoming.on('end', () => done({ headers: incoming.headers, body }));
        })
          .on('error', fail)
          .end();
      },
    );
    expect(JSON.parse(response.body)).toEqual({
      host: `localhost:${String(port)}`,
      proto: 'https',
      forwardedHost: `localhost:${String(port)}`,
      forwardedPort: String(port),
    });
    expect(response.headers['x-dropped']).toBeUndefined();
  });

  it('passes a connection upgrade through in both directions', async () => {
    const socket = connect({ host: '127.0.0.1', port, servername: 'localhost', ca });
    await new Promise((done) => socket.once('secureConnect', done));
    socket.write(
      `GET /_next/webpack-hmr HTTP/1.1\r\nHost: localhost:${String(port)}\r\nUpgrade: probe\r\nConnection: Upgrade\r\n\r\n`,
    );
    let received = '';
    const echoed = new Promise<void>((done) => {
      socket.on('data', (data: Buffer) => {
        received += data.toString();
        if (received.includes('\r\n\r\n') && !received.includes('echo:')) socket.write('ping');
        if (received.includes('echo:ping')) done();
      });
    });
    await echoed;
    socket.destroy();
    expect(received.split('\r\n')[0]).toBe('HTTP/1.1 101 Switching Protocols');
    expect(received.endsWith('echo:ping')).toBe(true);
  });
});
