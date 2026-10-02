/**
 * The lifetime and body-limit contracts over HTTP/2, against a host that
 * terminates it itself (Deno, with a certificate). One connection carries
 * several streams, so a client that gives up resets a stream, not a socket,
 * and the endpoint has to see that as a disconnect all the same.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  connect,
  constants,
  type ClientHttp2Session,
  type ClientHttp2Stream,
  type IncomingHttpHeaders,
} from 'node:http2';
import { expect, test, type APIRequestContext } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
const CA = process.env['PLP_HOST_CA'];
if (!CREDENTIAL || !CA) {
  throw new Error('Use playwright.fragment-hosts.config.ts with an HTTP/2 host.');
}
const AUTH = { 'x-plp-probe-key': CREDENTIAL };
const PHASES = ['authorization', 'props', 'render'] as const;
const LIMIT = 64 * 1024;
const BODY = JSON.stringify({
  fragment: 'probe',
  route: '/lifetime-page',
  search: '',
  revision: 7,
  fields: { title: 'Unsaved local probe' },
});

type Result =
  | { kind: 'response'; status: number; headers: IncomingHttpHeaders; body: string }
  | { kind: 'reset'; code: number }
  | { kind: 'error'; code: string | undefined };

interface Observation {
  readonly events: string[];
  readonly transportAborted: boolean;
  readonly status?: number;
}

async function observe(request: APIRequestContext, id: string): Promise<Observation | null> {
  const response = await request.get(`/payload/lifetime-probe?id=${id}`, { headers: AUTH });
  expect(response.status()).toBe(200);
  return (await response.json()) as Observation | null;
}

function open(origin: string): ClientHttp2Session {
  const session = connect(origin, { ca: readFileSync(CA!) });
  session.on('error', () => {});
  return session;
}

function post(
  session: ClientHttp2Session,
  origin: string,
  id: string,
  mode: string,
  options: {
    disconnect?: boolean;
    incompleteBody?: boolean;
    body?: string | Buffer;
    length?: boolean;
  } = {},
): { stream: ClientHttp2Stream; result: Promise<Result> } {
  const payload = options.body ?? BODY;
  const stream = session.request({
    ':method': 'POST',
    ':path': `/payload/lifetime-probe?id=${id}`,
    ...AUTH,
    origin,
    'content-type': 'application/json',
    'x-plp-probe-mode': mode,
    'x-plp-probe-disconnect': String(options.disconnect ?? false),
    ...(options.length === false ? {} : { 'content-length': String(Buffer.byteLength(payload)) }),
  });
  const result = new Promise<Result>((resolve) => {
    let status = 0;
    let headers: IncomingHttpHeaders = {};
    let body = '';
    let done = false;
    const settle = (value: Result): void => {
      if (done) return;
      done = true;
      resolve(value);
    };
    stream.setEncoding('utf8');
    stream.on('response', (received) => {
      headers = received;
      status = Number(received[':status']);
    });
    stream.on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('end', () => {
      settle({ kind: 'response', status, headers, body });
    });
    stream.on('close', () => {
      if (status > 0 && !done) settle({ kind: 'response', status, headers, body });
      else settle({ kind: 'reset', code: stream.rstCode });
    });
    stream.on('error', (error: NodeJS.ErrnoException) => {
      settle({ kind: 'error', code: error.code });
    });
    stream.setTimeout(6_000, () => {
      stream.close(constants.NGHTTP2_CANCEL);
    });
  });
  if (options.incompleteBody) stream.write(String(payload).slice(0, 20));
  else stream.end(payload);
  return { stream, result };
}

function expectPrivate(result: Result, status: number): Record<string, unknown> {
  expect(result.kind).toBe('response');
  if (result.kind !== 'response') throw new Error(`stream ended as ${result.kind}`);
  expect(result.status).toBe(status);
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.headers['x-content-type-options']).toBe('nosniff');
  expect(result.headers['x-payload-fragment-version']).toBe('1');
  return JSON.parse(result.body) as Record<string, unknown>;
}

test('successful work over HTTP/2 completes all three phases', async ({ baseURL, request }) => {
  const session = open(baseURL!);
  try {
    const id = randomUUID();
    const operation = post(session, baseURL!, id, 'success');
    expect(expectPrivate(await operation.result, 200)).toMatchObject({
      revision: 7,
      boundary: { id: 'probe' },
      html: '<p>local lifetime probe</p>',
    });
    expect(await observe(request, id)).toMatchObject({
      status: 200,
      transportAborted: false,
      events: PHASES.flatMap((phase) => [`${phase}:start`, `${phase}:end`]).concat('endpoint:end'),
    });
  } finally {
    session.destroy();
  }
});

PHASES.forEach((phase) => {
  test(`total deadline stops ${phase} over HTTP/2 and the connection serves the next stream`, async ({
    baseURL,
    request,
  }) => {
    const session = open(baseURL!);
    try {
      const id = randomUUID();
      const operation = post(session, baseURL!, id, phase);
      expect(expectPrivate(await operation.result, 504)).toEqual({ error: 'timeout' });
      const state = await observe(request, id);
      expect(state?.events).toContain(`${phase}:abort`);
      for (const later of PHASES.slice(PHASES.indexOf(phase) + 1)) {
        expect(state?.events).not.toContain(`${later}:start`);
      }
      expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
    } finally {
      session.destroy();
    }
  });
});

PHASES.forEach((phase) => {
  test(`a reset stream during ${phase} cancels server work before its deadline`, async ({
    baseURL,
    request,
  }) => {
    const session = open(baseURL!);
    try {
      const id = randomUUID();
      const operation = post(session, baseURL!, id, phase, { disconnect: true });
      await expect
        .poll(async () => (await observe(request, id))?.events, {
          timeout: 1_000,
          intervals: [20, 40, 80],
        })
        .toContain(`${phase}:start`);
      operation.stream.close(constants.NGHTTP2_CANCEL);
      await operation.result;
      await expect
        .poll(async () => observe(request, id), { timeout: 700, intervals: [20, 40, 80] })
        .toMatchObject({ transportAborted: true, status: 400 });
      const state = await observe(request, id);
      expect(state?.events).toContain(`${phase}:abort`);
      for (const later of PHASES.slice(PHASES.indexOf(phase) + 1)) {
        expect(state?.events).not.toContain(`${later}:start`);
      }
      // The connection outlives the reset stream.
      expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
    } finally {
      session.destroy();
    }
  });
});

test('a reset stream during an incomplete upload stops before authorization', async ({
  baseURL,
  request,
}) => {
  const session = open(baseURL!);
  try {
    const id = randomUUID();
    const operation = post(session, baseURL!, id, 'success', {
      incompleteBody: true,
      disconnect: true,
    });
    await expect.poll(() => observe(request, id)).not.toBeNull();
    operation.stream.close(constants.NGHTTP2_CANCEL);
    await operation.result;
    await expect
      .poll(() => observe(request, id), { timeout: 700, intervals: [20, 40, 80] })
      .toMatchObject({ status: 400, events: ['endpoint:end'] });
    expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
  } finally {
    session.destroy();
  }
});

test('a body still being uploaded is bounded before authorization starts', async ({
  baseURL,
  request,
}) => {
  const session = open(baseURL!);
  try {
    const id = randomUUID();
    const operation = post(session, baseURL!, id, 'success', { incompleteBody: true });
    expect(expectPrivate(await operation.result, 504)).toEqual({ error: 'timeout' });
    expect(await observe(request, id)).toMatchObject({ status: 504, events: ['endpoint:end'] });
    operation.stream.close(constants.NGHTTP2_CANCEL);
  } finally {
    session.destroy();
  }
});

test('an oversized body is refused at the byte, declared or not', async ({ baseURL, request }) => {
  const session = open(baseURL!);
  try {
    const big = JSON.stringify({
      fragment: 'probe',
      route: '/lifetime-page',
      search: '',
      revision: 7,
      fields: { pad: '界'.repeat(30_000) },
    });
    expect(big.length).toBeLessThan(LIMIT);
    for (const length of [true, false]) {
      const id = randomUUID();
      const operation = post(session, baseURL!, id, 'success', { body: big, length });
      expect(expectPrivate(await operation.result, 413)).toEqual({ error: 'body' });
      expect((await observe(request, id))?.events).toEqual(['endpoint:end']);
    }
    // The connection serves the next stream after both refusals.
    expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
  } finally {
    session.destroy();
  }
});

test('a blocked stream does not delay another stream on the same connection', async ({
  baseURL,
  request,
}) => {
  const session = open(baseURL!);
  try {
    const id = randomUUID();
    const blocked = post(session, baseURL!, id, 'props', { disconnect: true });
    await expect.poll(async () => (await observe(request, id))?.events).toContain('props:start');
    const started = Date.now();
    expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
    expect(Date.now() - started).toBeLessThan(500);
    expect((await observe(request, id))?.status).toBeUndefined();
    expect(expectPrivate(await blocked.result, 504)).toEqual({ error: 'timeout' });
  } finally {
    session.destroy();
  }
});

test('sequential requests share one connection', async ({ baseURL }) => {
  const session = open(baseURL!);
  try {
    let sessions = 0;
    session.on('connect', () => {
      sessions += 1;
    });
    expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
    expectPrivate(await post(session, baseURL!, randomUUID(), 'success').result, 200);
    expect(session.destroyed).toBe(false);
    expect(sessions).toBeLessThanOrEqual(1);
  } finally {
    session.destroy();
  }
});
