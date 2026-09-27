/**
 * Observe phase entry and cancellation through each framework's actual Node
 * production server. A closed client socket is checked against server state;
 * it is not itself evidence that application work stopped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { Agent as SecureAgent, request as httpsRequest } from 'node:https';
import { expect, test, type APIRequestContext } from '@playwright/test';

const PHASES = ['authorization', 'props', 'render'] as const;
const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
if (!CREDENTIAL) throw new Error('Use playwright.fragment-lifetime.config.ts.');
const AUTH_HEADERS = { 'x-plp-probe-key': CREDENTIAL };

function certificate(origin: string): { ca: Buffer } | Record<string, never> {
  if (!origin.startsWith('https:')) return {};
  const path = process.env['PLP_LIFETIME_CERTIFICATE'];
  if (!path) throw new Error('The local TLS fixture certificate path is required.');
  return { ca: readFileSync(path) };
}
const BODY = JSON.stringify({
  fragment: 'probe',
  route: '/lifetime-page',
  search: '',
  revision: 7,
  fields: { title: 'Unsaved local probe' },
});

interface Observation {
  readonly events: string[];
  readonly transportAborted: boolean;
  readonly status?: number;
}

async function observe(request: APIRequestContext, id: string): Promise<Observation | null> {
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, {
    headers: AUTH_HEADERS,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Observation | null;
}

function post(
  origin: string,
  id: string,
  mode: string,
  options: { disconnect?: boolean; incompleteBody?: boolean; agent?: Agent } = {},
) {
  type Result =
    | { kind: 'response'; status: number | undefined; headers: IncomingHttpHeaders; body: string }
    | { kind: 'transport-error'; code: string | undefined };
  let settle!: (result: Result) => void;
  const result = new Promise<Result>((resolve) => {
    settle = resolve;
  });
  const send = origin.startsWith('https:') ? httpsRequest : httpRequest;
  const pending = send(
    new URL(`/payload/lifetime-probe?id=${id}`, origin),
    {
      method: 'POST',
      agent: options.agent,
      ...certificate(origin),
      headers: {
        ...AUTH_HEADERS,
        origin,
        'content-type': 'application/json',
        'x-plp-probe-mode': mode,
        'x-plp-probe-disconnect': String(options.disconnect ?? false),
      },
    },
    (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        settle({ kind: 'response', status: response.statusCode, headers: response.headers, body });
      });
      response.on('error', (error: NodeJS.ErrnoException) => {
        settle({ kind: 'transport-error', code: error.code });
      });
    },
  );
  pending.setTimeout(5_000, () => pending.destroy(new Error('probe transport timed out')));
  pending.on('error', (error: NodeJS.ErrnoException) => {
    settle({ kind: 'transport-error', code: error.code });
  });
  if (options.incompleteBody) pending.write(BODY.slice(0, 20));
  else pending.end(BODY);
  return { pending, result };
}

function expectPrivateResponse(result: Awaited<ReturnType<typeof post>['result']>, status: number) {
  expect(result.kind).toBe('response');
  if (result.kind !== 'response') throw new Error(`transport failed: ${result.code}`);
  expect(result.status).toBe(status);
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['x-payload-fragment-version']).toBe('1');
  return JSON.parse(result.body) as Record<string, unknown>;
}

test('the diagnostic route refuses a request without its credential', async ({ request }) => {
  const response = await request.get('/payload/lifetime-probe?id=private');
  expect(response.status()).toBe(404);
});

test('a valid probe credential does not authorize a foreign HTTP origin', async ({ request }) => {
  const response = await request.post(`/payload/lifetime-probe?id=${randomUUID()}`, {
    headers: { ...AUTH_HEADERS, origin: 'https://foreign.example.test' },
    data: JSON.parse(BODY) as Record<string, unknown>,
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'origin' });
});

test('successful work carries its revision and completes all three phases', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const operation = post(baseURL!, id, 'success');
  const body = expectPrivateResponse(await operation.result, 200);
  expect(body).toMatchObject({
    revision: 7,
    boundary: { id: 'probe' },
    html: '<p>local lifetime probe</p>',
  });
  expect(await observe(request, id)).toMatchObject({
    status: 200,
    transportAborted: false,
    events: PHASES.flatMap((phase) => [`${phase}:start`, `${phase}:end`]).concat('endpoint:end'),
  });
});

PHASES.forEach((phase) => {
  test(`total deadline stops ${phase} and no later phase begins`, async ({ baseURL, request }) => {
    const id = randomUUID();
    const operation = post(baseURL!, id, phase);
    expect(expectPrivateResponse(await operation.result, 504)).toEqual({ error: 'timeout' });
    const state = await observe(request, id);
    expect(state?.events).toContain(`${phase}:abort`);
    expect(state?.status).toBe(504);
    for (const later of PHASES.slice(PHASES.indexOf(phase) + 1)) {
      expect(state?.events).not.toContain(`${later}:start`);
    }
    const recovery = post(baseURL!, randomUUID(), 'success');
    expectPrivateResponse(await recovery.result, 200);
  });
});

test('one deadline covers the sum of authorization, props and render', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const operation = post(baseURL!, id, 'sum');
  expect(expectPrivateResponse(await operation.result, 504)).toEqual({ error: 'timeout' });
  const state = await observe(request, id);
  expect(state?.events).toEqual([
    'authorization:start',
    'authorization:end',
    'props:start',
    'props:end',
    'render:start',
    'render:abort',
    'render:end',
    'endpoint:end',
  ]);
});

test('a body still being uploaded is bounded before authorization starts', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const operation = post(baseURL!, id, 'success', { incompleteBody: true });
  try {
    const result = await operation.result;
    await test.info().attach('body-deadline-observation', {
      contentType: 'application/json',
      body: JSON.stringify({ result, server: await observe(request, id) }),
    });
    expect(expectPrivateResponse(result, 504)).toEqual({ error: 'timeout' });
    expect(await observe(request, id)).toMatchObject({ status: 504, events: ['endpoint:end'] });
  } finally {
    operation.pending.destroy();
  }
});

PHASES.forEach((phase) => {
  test(`disconnect during ${phase} cancels server work before its deadline`, async ({
    baseURL,
    request,
  }) => {
    const id = randomUUID();
    const operation = post(baseURL!, id, phase, { disconnect: true });
    try {
      await expect
        .poll(async () => (await observe(request, id))?.events, {
          timeout: 1_000,
          intervals: [20, 40, 80],
        })
        .toContain(`${phase}:start`);
      operation.pending.destroy();
      await operation.result;
      // Capture both the early disconnect expectation and the eventual bounded
      // outcome. A deadline-only stop must not pass as native disconnect support.
      let early: Observation | null = null;
      let final: Observation | null = null;
      try {
        await expect
          .poll(
            async () => {
              early = await observe(request, id);
              return early;
            },
            { timeout: 700, intervals: [20, 40, 80] },
          )
          .toMatchObject({ transportAborted: true, status: 400 });
      } finally {
        await expect
          .poll(
            async () => {
              final = await observe(request, id);
              return final?.status;
            },
            { timeout: 3_000 },
          )
          .toBeDefined();
        await test.info().attach('disconnect-observation', {
          contentType: 'application/json',
          body: JSON.stringify({ early, final }),
        });
      }
      const state = await observe(request, id);
      expect(state?.events).toContain(`${phase}:abort`);
      for (const later of PHASES.slice(PHASES.indexOf(phase) + 1)) {
        expect(state?.events).not.toContain(`${later}:start`);
      }
    } finally {
      operation.pending.destroy();
    }
  });
});

test('a blocked request does not serialize an independent editor', async ({ baseURL, request }) => {
  const id = randomUUID();
  const blocked = post(baseURL!, id, 'props', { disconnect: true });
  try {
    await expect.poll(async () => (await observe(request, id))?.events).toContain('props:start');
    const independent = post(baseURL!, randomUUID(), 'success');
    expectPrivateResponse(await independent.result, 200);
    expect((await observe(request, id))?.status).toBeUndefined();
    expect(expectPrivateResponse(await blocked.result, 504)).toEqual({ error: 'timeout' });
  } finally {
    blocked.pending.destroy();
  }
});

test('disconnect during an incomplete upload stops before authorization', async ({
  baseURL,
  request,
}) => {
  const id = randomUUID();
  const operation = post(baseURL!, id, 'success', { incompleteBody: true, disconnect: true });
  try {
    await expect.poll(() => observe(request, id)).not.toBeNull();
    operation.pending.destroy();
    await operation.result;
    await expect
      .poll(() => observe(request, id), { timeout: 700, intervals: [20, 40, 80] })
      .toMatchObject({ status: 400, transportAborted: true, events: ['endpoint:end'] });
    expectPrivateResponse(await post(baseURL!, randomUUID(), 'success').result, 200);
  } finally {
    operation.pending.destroy();
  }
});

test('fully read requests can reuse one keep-alive connection', async ({ baseURL }) => {
  const AgentType = baseURL!.startsWith('https:') ? SecureAgent : Agent;
  const agent = new AgentType({ keepAlive: true, maxSockets: 1, ...certificate(baseURL!) });
  try {
    const first = post(baseURL!, randomUUID(), 'success', { agent });
    expectPrivateResponse(await first.result, 200);
    const socket = first.pending.socket;
    expect(socket).not.toBeNull();
    expect(socket?.destroyed).toBe(false);
    const second = post(baseURL!, randomUUID(), 'success', { agent });
    expectPrivateResponse(await second.result, 200);
    expect(second.pending.socket).toBe(socket);
    expect(socket?.destroyed).toBe(false);
  } finally {
    agent.destroy();
  }
});
