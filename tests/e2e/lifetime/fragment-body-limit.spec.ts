/**
 * The request body limit at the byte, through each host's real HTTP server.
 * The probe route authorizes only after the body is read, so a refusal shows
 * as a 413 with no phase entered. Declared length is an early hint; the bytes
 * that arrive decide.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gzipSync } from 'node:zlib';
import { expect, test, type APIRequestContext } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
if (!CREDENTIAL) throw new Error('Use playwright.fragment-lifetime.config.ts or the hosts config.');
const AUTH = { 'x-plp-probe-key': CREDENTIAL };
const LIMIT = 64 * 1024;

/** The CA of a TLS host or proxy, when the origin is https. */
function trust(origin: string): { ca: Buffer } | Record<string, never> {
  if (!origin.startsWith('https:')) return {};
  const path = process.env['PLP_LIFETIME_CERTIFICATE'];
  if (!path) throw new Error('PLP_LIFETIME_CERTIFICATE names the CA of a TLS host.');
  return { ca: readFileSync(path) };
}

/** A valid request whose UTF-8 length is exactly `bytes`, padded with two-byte characters. */
function bodyOfBytes(bytes: number): string {
  const frame = (pad: string): string =>
    JSON.stringify({
      fragment: 'probe',
      route: '/lifetime-page',
      search: '',
      revision: 7,
      fields: { pad },
    });
  const bare = new TextEncoder().encode(frame('')).byteLength;
  const room = bytes - bare;
  // Two-byte characters first, one ASCII byte when the room is odd.
  const body = frame('é'.repeat(Math.floor(room / 2)) + (room % 2 === 1 ? 'x' : ''));
  expect(new TextEncoder().encode(body).byteLength).toBe(bytes);
  return body;
}

interface Observation {
  readonly events: string[];
  readonly status?: number;
}
async function observe(request: APIRequestContext, id: string): Promise<Observation | null> {
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, { headers: AUTH });
  return (await response.json()) as Observation | null;
}

function expectRefusal(status: number, headers: IncomingHttpHeaders, body: string): void {
  expect(status).toBe(413);
  expect(headers['cache-control']).toBe('private, no-store');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-payload-fragment-version']).toBe('1');
  expect(body).toBe('{"error":"body"}');
}

/** One POST over a fresh connection, chunks sent as `pieces` say, answered or not. */
function send(
  origin: string,
  id: string,
  pieces: readonly { readonly data: Buffer | string; readonly afterMs: number }[],
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const url = new URL(`/payload/lifetime-probe?id=${id}`, origin);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (): void => {
      for (const timer of timers) clearTimeout(timer);
    };
    const pending = (origin.startsWith('https:') ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        agent: false,
        ...trust(origin),
        headers: { ...AUTH, origin, 'content-type': 'application/json', ...headers },
      },
      (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          settled = true;
          finish();
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body });
        });
      },
    );
    pending.setTimeout(5_000, () => {
      pending.destroy(new Error('request timed out'));
    });
    pending.on('error', (error) => {
      finish();
      if (!settled) reject(error);
    });
    pieces.forEach((piece, index) => {
      const last = index === pieces.length - 1;
      timers.push(
        setTimeout(() => {
          if (last) pending.end(piece.data);
          else pending.write(piece.data);
        }, piece.afterMs),
      );
    });
  });
}

test('the byte at the limit is accepted and the next byte is refused, in multibyte text', async ({
  baseURL,
  request,
}) => {
  const atLimit = await send(
    baseURL!,
    randomUUID(),
    [{ data: bodyOfBytes(LIMIT), afterMs: 0 }],
    {},
  );
  expect(atLimit.status).toBe(200);
  const id = randomUUID();
  const over = await send(baseURL!, id, [{ data: bodyOfBytes(LIMIT + 1), afterMs: 0 }], {});
  expectRefusal(over.status, over.headers, over.body);
  expect((await observe(request, id))?.events).toEqual(['endpoint:end']);
});

test('a code-unit count under the limit does not hide a byte count over it', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  // 30 000 three-byte characters: 30 000 code units, about 90 000 bytes.
  const body = JSON.stringify({
    fragment: 'probe',
    route: '/lifetime-page',
    search: '',
    revision: 7,
    fields: { pad: '界'.repeat(30_000) },
  });
  expect(body.length).toBeLessThan(LIMIT);
  const result = await send(baseURL!, id, [{ data: body, afterMs: 0 }], {});
  expectRefusal(result.status, result.headers, result.body);
  expect((await observe(request, id))?.events).toEqual(['endpoint:end']);
});

test('a body without a declared length is cut at the limit while the rest is withheld', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const bytes = Buffer.from(bodyOfBytes(LIMIT * 2));
  const result = await send(
    baseURL!,
    id,
    [
      { data: bytes.subarray(0, 40_000), afterMs: 0 },
      { data: bytes.subarray(40_000, 80_000), afterMs: 20 },
      { data: bytes.subarray(80_000), afterMs: 300 },
    ],
    { 'transfer-encoding': 'chunked' },
  );
  expectRefusal(result.status, result.headers, result.body);
  expect((await observe(request, id))?.events).toEqual(['endpoint:end']);
});

test('a content encoding is not undone: the bytes counted are the bytes sent', async ({
  baseURL,
  request,
}) => {
  const headers = { 'content-encoding': 'gzip' };
  // A request that would be valid once inflated, and eight megabytes of blanks that
  // inflate far past the limit. Both are small on the wire; neither is accepted.
  const valid = gzipSync(bodyOfBytes(1_000));
  const blanks = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
  expect(blanks.byteLength).toBeLessThan(LIMIT);
  for (const body of [valid, blanks]) {
    const id = randomUUID();
    const result = await send(baseURL!, id, [{ data: body, afterMs: 0 }], headers);
    expect(result.status).toBe(400);
    expect(result.body).toBe('{"error":"shape"}');
    expect((await observe(request, id))?.events).toEqual(['endpoint:end']);
  }
});
