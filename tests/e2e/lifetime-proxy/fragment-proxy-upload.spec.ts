/**
 * What a proxy in front of the endpoint does with an upload the client has not
 * finished, seen from the client's side of the wire and from the probe's
 * observation route. Two kinds are held to account: one that buffers the whole
 * body before the upstream sees any of it, and one that forwards the request
 * at once but delivers the endpoint's answer only after the upload has ended
 * (Caddy and Traefik speaking HTTP/1.1 to the client). A streaming proxy needs
 * neither case: the lifetime specs hold it to the endpoint's own contract.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { expect, test, type APIRequestContext } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
const KIND = process.env['PLP_HOST_UPLOAD'];
if (!CREDENTIAL || (KIND !== 'buffers' && KIND !== 'holds-answer')) {
  throw new Error('Use playwright.fragment-hosts.config.ts with a proxy that has an upload kind.');
}
const AUTH = { 'x-plp-probe-key': CREDENTIAL };
const BODY = JSON.stringify({
  fragment: 'probe',
  route: '/lifetime-page',
  search: '',
  revision: 7,
  fields: { title: 'Unsaved local probe' },
});
const HEAD = 20;

interface Observation {
  readonly events: string[];
  readonly status?: number;
}

async function observe(request: APIRequestContext, id: string): Promise<Observation | null> {
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, { headers: AUTH });
  expect(response.status()).toBe(200);
  return (await response.json()) as Observation | null;
}

/** A POST whose body stops after `HEAD` bytes until `finish()` sends the rest. */
function upload(origin: string, id: string) {
  const https = origin.startsWith('https:');
  const ca = https ? readFileSync(process.env['PLP_LIFETIME_CERTIFICATE']!) : undefined;
  // A browser keeps its connection alive, and what a proxy does with an unfinished
  // upload depends on it: a request that asks to close is answered at once.
  const agent = https ? new HttpsAgent({ keepAlive: true }) : new HttpAgent({ keepAlive: true });
  let answered = false;
  let pending!: ReturnType<typeof httpRequest>;
  const outcome = new Promise<{ status: number; body: string }>((resolve, reject) => {
    pending = (https ? httpsRequest : httpRequest)(
      new URL(`/payload/lifetime-probe?id=${id}`, origin),
      {
        method: 'POST',
        agent,
        ...(ca === undefined ? {} : { ca }),
        headers: {
          ...AUTH,
          origin,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(BODY)),
        },
      },
      (response) => {
        answered = true;
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          agent.destroy();
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    pending.setTimeout(10_000, () => {
      pending.destroy(new Error('no answer within 10 s'));
    });
    pending.on('error', reject);
    pending.write(BODY.slice(0, HEAD));
  });
  return {
    outcome,
    answered: () => answered,
    finish: () => {
      pending.end(BODY.slice(HEAD));
    },
  };
}

test.describe(`a proxy that ${KIND === 'buffers' ? 'buffers the request body' : 'holds the answer'}`, () => {
  test('a half-sent upload', async ({ baseURL, request }) => {
    const id = randomUUID();
    const sending = upload(baseURL!, id);
    // Well past the endpoint's 400 ms deadline for a body that does not arrive.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(sending.answered()).toBe(false);
    if (KIND === 'buffers') {
      // The endpoint has not been asked anything yet.
      expect(await observe(request, id)).toBeNull();
      sending.finish();
      const answer = await sending.outcome;
      expect(answer.status).toBe(200);
      expect(await observe(request, id)).toMatchObject({ status: 200 });
    } else {
      // The endpoint answered 504 at its deadline; the proxy keeps it back.
      expect(await observe(request, id)).toMatchObject({ status: 504, events: ['endpoint:end'] });
      sending.finish();
      const answer = await sending.outcome;
      expect(answer.status).toBe(504);
      expect(answer.body).toBe('{"error":"timeout"}');
    }
  });
});
