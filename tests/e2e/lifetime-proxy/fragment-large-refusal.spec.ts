/**
 * A proxy with a body limit of its own above the endpoint's 64 KiB. A body over
 * that limit is answered 413 by the proxy, whole each time, before the endpoint
 * is asked. A body between the two limits reaches the endpoint, which refuses it
 * and closes the connection with the body unread; a proxy still writing then
 * answers 502 for a few requests in a hundred, so that band is not asserted.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { expect, test, type APIRequestContext } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
if (!CREDENTIAL) throw new Error('Use playwright.fragment-hosts.config.ts with a limited proxy.');
const AUTH = { 'x-plp-probe-key': CREDENTIAL };
const ATTEMPTS = 20;
const SIZES = [300_000, 2_000_000] as const;

function bodyOf(approximateBytes: number): string {
  return JSON.stringify({
    fragment: 'probe',
    route: '/lifetime-page',
    search: '',
    revision: 7,
    fields: { pad: 'x'.repeat(approximateBytes) },
  });
}

/** One POST over a fresh connection, the whole body sent. */
function post(origin: string, id: string, body: string): Promise<{ status: number; body: string }> {
  const https = origin.startsWith('https:');
  const ca = https ? readFileSync(process.env['PLP_LIFETIME_CERTIFICATE']!) : undefined;
  return new Promise((resolve, reject) => {
    const pending = (https ? httpsRequest : httpRequest)(
      new URL(`/payload/lifetime-probe?id=${id}`, origin),
      {
        method: 'POST',
        agent: false,
        ...(ca === undefined ? {} : { ca }),
        headers: {
          ...AUTH,
          origin,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        response.setEncoding('utf8');
        let text = '';
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: text });
        });
      },
    );
    pending.setTimeout(8_000, () => {
      pending.destroy(new Error('no answer within 8 s'));
    });
    pending.on('error', reject);
    pending.end(body);
  });
}

async function observe(
  request: APIRequestContext,
  id: string,
): Promise<{ events: string[] } | null> {
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, { headers: AUTH });
  return (await response.json()) as { events: string[] } | null;
}

SIZES.forEach((bytes) => {
  test(`${String(bytes / 1000)} kB over the proxy's limit is answered 413, ${String(ATTEMPTS)} of ${String(ATTEMPTS)}`, async ({
    baseURL,
    request,
  }) => {
    const body = bodyOf(bytes);
    const answers: string[] = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const id = randomUUID();
      try {
        answers.push(String((await post(baseURL!, id, body)).status));
      } catch (error) {
        answers.push((error as NodeJS.ErrnoException).code ?? 'error');
      }
      // The proxy refused before the endpoint was asked.
      expect(await observe(request, id)).toBeNull();
    }
    expect(answers).toEqual(Array<string>(ATTEMPTS).fill('413'));
  });
});
