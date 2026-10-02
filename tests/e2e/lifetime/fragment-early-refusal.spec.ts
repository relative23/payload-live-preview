/**
 * A declared length over the limit is refused on the headers alone, before one
 * body byte arrives. A proxy that buffers the request body has no headers-only
 * request to forward, so the hosts config leaves this file out for it.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { expect, test } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
if (!CREDENTIAL) throw new Error('Use playwright.fragment-lifetime.config.ts or the hosts config.');
const AUTH = { 'x-plp-probe-key': CREDENTIAL };
const LIMIT = 64 * 1024;

function trust(origin: string): { ca: Buffer } | Record<string, never> {
  if (!origin.startsWith('https:')) return {};
  const path = process.env['PLP_LIFETIME_CERTIFICATE'];
  if (!path) throw new Error('PLP_LIFETIME_CERTIFICATE names the CA of a TLS host.');
  return { ca: readFileSync(path) };
}

test('a declared length over the limit is refused before any body byte is sent', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const url = new URL(baseURL!);
  const wire = await new Promise<string>((resolve, reject) => {
    const socket =
      url.protocol === 'https:'
        ? tlsConnect({ host: url.hostname, port: Number(url.port), ...trust(baseURL!) })
        : createConnection({ host: url.hostname, port: Number(url.port) });
    let received = '';
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
      if (received.includes('\r\n\r\n')) socket.destroy();
    });
    socket.on('close', () => {
      resolve(received);
    });
    socket.on('error', reject);
    socket.setTimeout(3_000, () => {
      socket.destroy(new Error('no answer to a declared oversize body'));
    });
    socket.write(
      [
        `POST /payload/lifetime-probe?id=${id} HTTP/1.1`,
        `host: ${url.host}`,
        `origin: ${url.origin}`,
        `x-plp-probe-key: ${CREDENTIAL}`,
        'content-type: application/json',
        `content-length: ${String(LIMIT * 16)}`,
        '',
        '',
      ].join('\r\n'),
    );
  });
  expect(wire.split('\r\n')[0]).toMatch(/^HTTP\/1\.1 413 /u);
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, { headers: AUTH });
  expect(((await response.json()) as { events: string[] } | null)?.events).toEqual([
    'endpoint:end',
  ]);
});
