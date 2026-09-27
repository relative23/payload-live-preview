/**
 * Build and serve the Next fixture through a local TLS reverse proxy. The
 * public side matches strict production policy while `next start` stays on an
 * unexposed loopback port, the usual self-hosted deployment shape.
 */

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as requestHttp } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindProxyLifetime } from './fixture-proxy-lifetime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = process.env['PLP_NEXT_FIXTURE_DIRECTORY']
  ? resolve(process.env['PLP_NEXT_FIXTURE_DIRECTORY'])
  : resolve(ROOT, 'examples/nextjs-payload');
const NEXT_BIN = resolve(FIXTURE, 'node_modules/next/dist/bin/next');
const PUBLIC_ORIGIN = process.env['PLP_NEXT_ORIGIN'] ?? 'https://localhost:4274';
const publicUrl = new URL(PUBLIC_ORIGIN);
if (publicUrl.protocol !== 'https:') {
  throw new Error('PLP_NEXT_ORIGIN must use HTTPS for the production fixture.');
}
const publicPort = Number(publicUrl.port || 443);
const internalPort = Number(process.env['PLP_NEXT_INTERNAL_PORT'] ?? '42740');
const environment = {
  ...process.env,
  NODE_ENV: 'production',
  PAYLOAD_ADMIN_ORIGIN: publicUrl.origin,
};

const build = spawnSync('npm', ['run', 'build'], {
  cwd: FIXTURE,
  env: environment,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const certificateDirectory = mkdtempSync(join(tmpdir(), 'plp-next-production-'));
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
// Export only the public certificate for the lifetime probe's pinned TLS client.
const probeCertificate = process.env['PLP_LIFETIME_CERTIFICATE'];
if (probeCertificate) {
  mkdirSync(dirname(probeCertificate), { recursive: true });
  copyFileSync(certificatePath, probeCertificate);
}

const next = spawn(
  process.execPath,
  [NEXT_BIN, 'start', '--hostname', '127.0.0.1', '--port', String(internalPort)],
  { cwd: FIXTURE, env: environment, stdio: 'inherit' },
);

const proxy = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
  },
  (incoming, outgoing) => {
    const host = incoming.headers.host ?? publicUrl.host;
    const upstream = requestHttp(
      {
        hostname: '127.0.0.1',
        port: internalPort,
        method: incoming.method,
        path: incoming.url,
        headers: {
          ...incoming.headers,
          host,
          'x-forwarded-host': host,
          'x-forwarded-port': String(publicPort),
          'x-forwarded-proto': 'https',
        },
      },
      (response) => {
        // Next's page renderer overwrites config-level Vary. This fixture's
        // trusted TLS front door retains the private route's Cookie variation
        // alongside RSC/router values; it never changes the public routes.
        const privatePrefix = process.env['PLP_NEXT_PRIVATE_PREFIX'];
        if (privatePrefix && incoming.url?.startsWith(privatePrefix)) {
          const vary = (response.headers.vary ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
          if (!vary.some((part) => part.toLowerCase() === 'cookie')) vary.push('Cookie');
          response.headers.vary = vary.join(', ');
        }
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
      outgoing.end(`Next production fixture is not ready: ${error.message}`);
    });
    bindProxyLifetime(incoming, outgoing, upstream);
    incoming.pipe(upstream);
  },
);

let stopping = false;
/** @type {(signal: NodeJS.Signals) => void} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain Node entry, intentionally runnable without a TypeScript loader
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  proxy.close();
  if (next.exitCode === null) next.kill(signal);
};

process.once('SIGINT', () => {
  stop('SIGINT');
});
process.once('SIGTERM', () => {
  stop('SIGTERM');
});
next.once('exit', (code, signal) => {
  if (!stopping) {
    process.exitCode = code ?? (signal === null ? 1 : 0);
    proxy.close();
  }
});
process.once('exit', () => {
  rmSync(certificateDirectory, { recursive: true, force: true });
});

proxy.listen(publicPort, '127.0.0.1', () => {
  process.stdout.write(`Next production fixture listening on ${publicUrl.origin}\n`);
});
