/**
 * The local TLS front door of the fixtures: a throw-away certificate for localhost and a proxy
 * to a loopback listener, the way a self-hosted site sits behind its terminating proxy.
 * Connection upgrades pass through too, so a development server's WebSocket works behind it.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as requestHttp } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindProxyLifetime } from './fixture-proxy-lifetime.mjs';

/**
 * @typedef {object} TlsFrontOptions
 * @property {string} label Named in the log line and in the not-ready answer.
 * @property {URL} publicUrl The HTTPS origin the browser uses.
 * @property {number} internalPort The loopback port the application listens on.
 * @property {string} [certificateOut] Where to copy the public certificate, for a client that must trust it.
 * @property {(incoming: import('node:http').IncomingMessage, response: import('node:http').IncomingMessage) => void} [adjust]
 *   Changes an upstream response's headers before they are sent on.
 */

/**
 * @param {TlsFrontOptions} options
 * @returns {{ close: () => void }}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain Node entry shared by fixture launchers
export function startTlsFront({ label, publicUrl, internalPort, adjust, certificateOut }) {
  const publicPort = Number(publicUrl.port || 443);
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'plp-tls-front-'));
  const keyPath = join(certificateDirectory, 'localhost-key.pem');
  const certificatePath = join(certificateDirectory, 'localhost-certificate.pem');
  const certificate = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  if (certificate.status !== 0) {
    process.stderr.write(certificate.stderr);
    process.exit(certificate.status ?? 1);
  }
  // Export only the public certificate: for the lifetime probe's pinned TLS client, or for a
  // server that calls this front and trusts the certificate through NODE_EXTRA_CA_CERTS.
  for (const probeCertificate of [process.env['PLP_LIFETIME_CERTIFICATE'], certificateOut]) {
    if (!probeCertificate) continue;
    mkdirSync(dirname(probeCertificate), { recursive: true });
    copyFileSync(certificatePath, probeCertificate);
  }
  process.once('exit', () => {
    rmSync(certificateDirectory, { recursive: true, force: true });
  });

  /** @param {import('node:http').IncomingMessage} incoming */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- native .mjs callback, not a TypeScript entry
  const forwarded = (incoming) => {
    const host = incoming.headers.host ?? publicUrl.host;
    return {
      ...incoming.headers,
      host,
      'x-forwarded-host': host,
      'x-forwarded-port': String(publicPort),
      'x-forwarded-proto': 'https',
    };
  };

  const proxy = createServer(
    {
      key: readFileSync(keyPath),
      cert: readFileSync(certificatePath),
    },
    (incoming, outgoing) => {
      const upstream = requestHttp(
        {
          hostname: '127.0.0.1',
          port: internalPort,
          method: incoming.method,
          path: incoming.url,
          headers: forwarded(incoming),
        },
        (response) => {
          adjust?.(incoming, response);
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', (error) => {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) {
          outgoing.destroy(error);
          return;
        }
        outgoing.writeHead(502, { 'content-type': 'text/plain' });
        outgoing.end(`${label} is not ready: ${error.message}`);
      });
      bindProxyLifetime(incoming, outgoing, upstream);
      incoming.pipe(upstream);
    },
  );

  // A WebSocket handshake gets its own upstream request; after the 101 both sockets are piped.
  proxy.on('upgrade', (incoming, socket, head) => {
    const upstream = requestHttp({
      hostname: '127.0.0.1',
      port: internalPort,
      method: incoming.method,
      path: incoming.url,
      headers: forwarded(incoming),
    });
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${String(response.statusCode)} ${response.statusMessage ?? ''}`];
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        lines.push(`${response.rawHeaders[index] ?? ''}: ${response.rawHeaders[index + 1] ?? ''}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
    });
    // An upstream that answers without upgrading closes the handshake.
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });

  proxy.listen(publicPort, '127.0.0.1', () => {
    process.stdout.write(`${label} listening on ${publicUrl.origin}\n`);
  });
  return { close: () => proxy.close() };
}
