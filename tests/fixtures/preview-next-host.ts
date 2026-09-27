/**
 * Local host-login wiring shared by the native framework consumers. Only a
 * real Payload login creates a host session; each use rechecks /me and the
 * server-owned document mapping. This bounded in-memory fixture is not a
 * deployed identity provider or a durable multi-instance session store.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as server from '@/server/index';
import { createReferenceContinuation, type ContinuationRecord } from './preview-continuation';
import {
  createReferenceDataHandler,
  PRIVATE_HEADERS,
  readJSON,
  cancel,
} from './preview-continuation-data';
import { createReferenceUnsavedHandler } from './preview-continuation-unsaved';

interface HostOptions {
  readonly enabled: boolean;
  readonly audience: string;
  readonly serverURL: string;
  readonly secret: string;
  readonly ids: Readonly<Record<string, string>>;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
}
interface Login {
  subject: string;
  editor: string;
  token: string;
  expiresAt: number;
}
const LOGIN_COOKIE = '__Host-plp-login';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { ...PRIVATE_HEADERS, ...headers } });

export function createNextHostReference(options: HostOptions) {
  const now = options.now ?? Date.now;
  const logins = new Map<string, Login>();
  const records = new Map<string, ContinuationRecord>();
  const consumed = new Map<string, number>();
  const sweep = (): void => {
    for (const [key, value] of logins) if (value.expiresAt <= now()) logins.delete(key);
    for (const [key, value] of records) if (value.expiresAt <= now()) records.delete(key);
    for (const [key, expiry] of consumed) if (expiry <= now()) consumed.delete(key);
  };
  const safe = (request: Request, post = false): boolean => {
    sweep();
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    return (
      options.enabled &&
      url.protocol === 'https:' &&
      url.origin === options.audience &&
      (post ? origin === options.audience : origin === null || origin === options.audience) &&
      (site === null || ['same-origin', 'same-site', 'none'].includes(site))
    );
  };
  const json = async (
    response: Pick<Response, 'body' | 'headers'>,
    signal: AbortSignal,
    limit: number,
  ) =>
    readJSON(
      response,
      {
        signal,
        async run<T>(action: () => T | PromiseLike<T>): Promise<T> {
          signal.throwIfAborted();
          let stop!: () => void;
          const stopped = new Promise<never>((_resolve, reject) => {
            stop = () => reject(new Error('Host request stopped'));
            signal.addEventListener('abort', stop, { once: true });
          });
          try {
            const value = await Promise.race([Promise.resolve().then(action), stopped]);
            signal.throwIfAborted();
            return value;
          } finally {
            signal.removeEventListener('abort', stop);
          }
        },
      },
      limit,
    );
  const principal = async (request: {
    headers: { get(name: string): string | null };
    signal?: AbortSignal;
  }) => {
    sweep();
    const cookie = server.extractCookie(request.headers.get('cookie'), LOGIN_COOKIE);
    const sessionId = cookie === null ? '' : hash(cookie);
    const login = logins.get(sessionId);
    if (login === undefined) return null;
    const signal = request.signal ?? AbortSignal.timeout(2_000);
    const response = await options.fetch(`${options.serverURL}/api/users/me`, {
      headers: { authorization: `JWT ${login.token}` },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      cancel(response.body);
      return null;
    }
    const body = await json(response, signal, 16_384);
    if (
      !object(body) ||
      !object(body['user']) ||
      String(body['user']['id']) !== login.subject ||
      body['user']['editor'] !== login.editor ||
      typeof body['exp'] !== 'number'
    ) {
      return null;
    }
    const expiresAt = Math.min(login.expiresAt, body['exp'] * 1000);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) return null;
    return {
      subject: login.subject,
      sessionId,
      expiresAt,
      payloadHeaders: { authorization: `JWT ${login.token}` },
    };
  };
  const reference = createReferenceContinuation({
    secret: options.secret,
    audience: options.audience,
    now,
    totalTimeoutMs: 5_000,
    authorizeRequest: server.authorizePreviewRequest,
    transport: { kind: 'header', name: 'x-preview-token' },
    principal,
    binding: (verified, request) => {
      const url = new URL(request.url);
      const match = /^\/continuation\/(a|b)\/(en|de)$/u.exec(url.pathname);
      if (match === null || options.ids[`user-${match[1]}`] !== verified.subject) return null;
      const id = options.ids[`article-${match[1]}`];
      if (!id) return null;
      return {
        audience: options.audience,
        serverURL: options.serverURL,
        path: url.pathname,
        locale: match[2],
        document: { kind: 'collection', slug: 'articles', id },
        depth: 2,
        expiresAt: verified.expiresAt,
      };
    },
    store: {
      consume(id, expiry) {
        sweep();
        if (consumed.has(id) || consumed.size >= 256) return false;
        consumed.set(id, expiry);
        return true;
      },
      publish(key, record) {
        sweep();
        if (records.has(key) || records.size >= 128) return false;
        records.set(key, record);
        return true;
      },
      read: (key) => {
        sweep();
        return records.get(key) ?? null;
      },
    },
  });
  const data = createReferenceDataHandler(reference, {
    fetch: options.fetch,
    define: server.definePreview,
  });
  const unsaved = createReferenceUnsavedHandler(reference, {
    fetch: options.fetch,
    define: server.definePreview,
    relatedDrafts: { authorizeRequest: server.authorizePreviewRequest },
  });
  return {
    async login(request: Request): Promise<Response> {
      if (!safe(request, true)) return empty(403);
      if (request.method !== 'POST') return empty(405);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(2_000)]);
      try {
        if (logins.size >= 32) return empty(503);
        const input = await json(request, signal, 1_024);
        if (
          !object(input) ||
          Object.keys(input).length !== 2 ||
          typeof input['email'] !== 'string' ||
          typeof input['password'] !== 'string'
        ) {
          return empty(400);
        }
        const response = await options.fetch(`${options.serverURL}/api/users/login`, {
          method: 'POST',
          body: JSON.stringify(input),
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          signal,
        });
        if (!response.ok) {
          cancel(response.body);
          return empty(403);
        }
        const body = await json(response, signal, 16_384);
        if (
          !object(body) ||
          typeof body['token'] !== 'string' ||
          !object(body['user']) ||
          typeof body['exp'] !== 'number'
        ) {
          return empty(403);
        }
        const user = body['user'];
        const editor = user['editor'];
        if (
          (editor !== 'a' && editor !== 'b') ||
          String(user['id']) !== options.ids[`user-${editor}`]
        ) {
          return empty(403);
        }
        const expiresAt = Math.min(body['exp'] * 1_000, now() + 300_000);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || logins.size >= 32) {
          return empty(403);
        }
        const handle = randomBytes(32).toString('base64url');
        logins.set(hash(handle), {
          subject: String(user['id']),
          editor,
          token: body['token'],
          expiresAt,
        });
        return empty(204, {
          'set-cookie': `${LOGIN_COOKIE}=${handle}; Path=/; Max-Age=${Math.ceil((expiresAt - now()) / 1000)}; Secure; HttpOnly; SameSite=Strict`,
        });
      } catch {
        return empty(403);
      } finally {
        cancel(request.body);
      }
    },
    async logout(request: Request): Promise<Response> {
      if (!safe(request, true)) return empty(403);
      if (request.method !== 'POST') return empty(405);
      const cookie = server.extractCookie(request.headers.get('cookie'), LOGIN_COOKIE);
      const key = cookie === null ? '' : hash(cookie);
      const login = logins.get(key);
      logins.delete(key);
      for (const [id, record] of records) if (record.sessionId === key) records.delete(id);
      if (login !== undefined) {
        try {
          const response = await options.fetch(`${options.serverURL}/api/users/logout`, {
            method: 'POST',
            headers: { authorization: `JWT ${login.token}` },
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(2_000),
          });
          cancel(response.body);
        } catch {
          /* Local revocation still holds when the upstream is unavailable. */
        }
      }
      return empty(204, {
        'set-cookie': `${LOGIN_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`,
      });
    },
    exchange: (request: Request) =>
      safe(request) ? reference.exchange(request) : Promise.resolve(empty(403)),
    load: (request: Request) => (safe(request) ? data(request) : Promise.resolve(empty(403))),
    async page(request: Request): Promise<{
      response: Response;
      authorization: server.AuthorizedPreviewContext | null;
    }> {
      // The native handle and server load share this request's verdict/read.
      // Never cache it on the host or return authority after a failed read.
      let authorization: server.AuthorizedPreviewContext | null = null;
      const scoped: typeof reference = {
        ...reference,
        withGrant: (incoming, action) =>
          reference.withGrant(incoming, (grant, work) => {
            authorization = grant.context;
            return action(grant, work);
          }),
      };
      const read = createReferenceDataHandler(scoped, {
        fetch: options.fetch,
        define: server.definePreview,
      });
      const response = safe(request) ? await read(request) : empty(403);
      return { response, authorization: response.ok ? authorization : null };
    },
    update: (request: Request) =>
      safe(request, true) ? unsaved(request) : Promise.resolve(empty(403)),
  };
}
