/**
 * Executable application contract for ADR 0019, not a package export or a
 * production session store. Existing token and verifier strategies retain
 * their contracts; the application binds and persists the continuation.
 */
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import {
  authorizePreviewRequest,
  extractCookie,
  type AuthorizedPreviewContext,
  type PreviewAuthorizationRequest,
  type PreviewTokenReplayStore,
  type PreviewTokenTransport,
  type SubtleCryptoLike,
} from '@security/preview-authorization';

export interface ContinuationPrincipal {
  readonly subject: string;
  readonly sessionId: string;
  readonly expiresAt: number;
  readonly payloadHeaders: Readonly<Record<string, string>>;
}

export interface ContinuationTarget {
  readonly audience: string;
  readonly serverURL: string;
  readonly apiRoute?: string;
  readonly path: string;
  readonly locale: string | undefined;
  readonly document:
    | { readonly kind: 'collection'; readonly slug: string; readonly id: string }
    | { readonly kind: 'global'; readonly slug: string };
  readonly depth: number;
  readonly expiresAt: number;
}

export interface ContinuationRecord {
  readonly subject: string;
  readonly sessionId: string;
  readonly target: ContinuationTarget;
  readonly expiresAt: number;
}

export interface ContinuationStore extends PreviewTokenReplayStore {
  /** Cancellation is cooperative and must never undo an already consumed proof. */
  consume(id: string, expiresAt: number, signal?: AbortSignal): Promise<boolean> | boolean;
  publish(key: string, record: ContinuationRecord, signal: AbortSignal): Promise<boolean> | boolean;
  read(
    key: string,
    signal: AbortSignal,
  ): Promise<ContinuationRecord | null> | ContinuationRecord | null;
}

export interface ContinuationOptions {
  readonly secret: string;
  readonly audience: string;
  readonly transport?: PreviewTokenTransport;
  readonly store: ContinuationStore | undefined;
  readonly now: () => number;
  /** One request-wide I/O deadline, including verification. Defaults to 1,000 ms. */
  readonly totalTimeoutMs?: number;
  /** Source and built-public-entry probes use the same coordinator contract. */
  readonly authorizeRequest?: typeof authorizePreviewRequest;
  readonly principal: (
    request: PreviewAuthorizationRequest,
  ) => Promise<ContinuationPrincipal | null> | ContinuationPrincipal | null;
  readonly binding: (
    principal: ContinuationPrincipal,
    request: PreviewAuthorizationRequest,
  ) => Promise<ContinuationTarget | null> | ContinuationTarget | null;
}

export interface ContinuationGrant {
  readonly context: AuthorizedPreviewContext;
  readonly target: ContinuationTarget;
}

/** A consumer shares the authorizer's deadline; it cannot extend or dispose it. */
export interface ContinuationWork {
  readonly signal: AbortSignal;
  run<T>(work: () => T | PromiseLike<T>): Promise<T>;
}

const PRIVATE_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie',
};
const MAX_LIFETIME_MS = 300_000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function targetKey(target: ContinuationTarget): string {
  return digest(
    JSON.stringify([
      target.audience,
      target.serverURL,
      target.apiRoute ?? '/api',
      target.path,
      target.locale ?? null,
      target.document.kind,
      target.document.slug,
      target.document.kind === 'collection' ? target.document.id : null,
      target.depth,
    ]),
  );
}

function cookieName(target: ContinuationTarget): string {
  // Separate documents/locales may be open in separate tabs on the same host.
  return `__Host-plp-preview-${targetKey(target)}`;
}

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

function current(expiry: number, now: number): boolean {
  return Number.isSafeInteger(expiry) && Number.isSafeInteger(now) && expiry > now;
}

class ContinuationStopped extends Error {}

/** Both entry and continuation own one clock, signal and set of cleanup handles. */
function requestLifetime(request: PreviewAuthorizationRequest, timeoutMs: number) {
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let closed = false;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (): void => {
    if (controller.signal.aborted) return;
    // Neither transport reasons nor backend errors belong in downstream logs.
    controller.abort('continuation-stopped');
    resolveStopped();
  };
  request.signal?.addEventListener('abort', stop, { once: true });
  if (request.signal?.aborted === true) stop();
  const timer = setTimeout(stop, timeoutMs);
  const check = (): void => {
    // Synchronous work can return before an overdue timer gets its turn.
    if (performance.now() >= deadline) stop();
    if (closed || controller.signal.aborted) throw new ContinuationStopped();
  };
  return {
    request: { url: request.url, headers: request.headers, signal: controller.signal },
    check,
    run: async <T>(work: () => T | PromiseLike<T>): Promise<T> => {
      check();
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => {
            check();
            return work();
          }),
          stopped.then(() => {
            throw new ContinuationStopped();
          }),
        ]);
        check();
        return value;
      } catch (error) {
        // Abort-driven resolution/rejection still cannot authorize another phase.
        check();
        throw error;
      }
    },
    dispose: (): void => {
      closed = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', stop);
    },
  };
}

export function createReferenceContinuation(options: ContinuationOptions) {
  const authorizeRequest = options.authorizeRequest ?? authorizePreviewRequest;
  const totalTimeoutMs = options.totalTimeoutMs ?? 1_000;
  if (
    !Number.isSafeInteger(totalTimeoutMs) ||
    totalTimeoutMs < 1 ||
    totalTimeoutMs > 2_147_483_647
  ) {
    throw new TypeError('Invalid continuation request deadline');
  }
  async function prepare(lifetime: ReturnType<typeof requestLifetime>) {
    lifetime.check();
    const request = lifetime.request;
    if (options.store === undefined) return null;
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.origin !== options.audience) return null;
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if (origin !== null && origin !== url.origin) return null;
    if (site !== null && !['same-origin', 'same-site', 'none'].includes(site)) return null;
    const verified = await lifetime.run(() => options.principal(request));
    if (!verified?.subject || !verified.sessionId) return null;
    const principal = Object.freeze({
      ...verified,
      payloadHeaders: Object.freeze({ ...verified.payloadHeaders }),
    });
    const mapped = await lifetime.run(() => options.binding(principal, request));
    if (mapped === null) return null;
    const target = Object.freeze({ ...mapped, document: Object.freeze({ ...mapped.document }) });
    const locales = url.searchParams.getAll('locale');
    if (locales.length > 1 || locales[0] !== target.locale) return null;
    if (target.audience !== url.origin || target.path !== url.pathname) return null;
    if (!Number.isSafeInteger(target.depth) || target.depth < 0 || !target.document.slug) {
      return null;
    }
    if (target.document.kind === 'collection' && !target.document.id) return null;
    const now = options.now();
    if (!current(principal.expiresAt, now) || !current(target.expiresAt, now)) return null;
    lifetime.check();
    return { principal, target };
  }

  async function authorize(
    lifetime: ReturnType<typeof requestLifetime>,
  ): Promise<ContinuationGrant | null> {
    const prepared = await prepare(lifetime);
    if (prepared === null) return null;
    const { principal, target } = prepared;
    const handle = extractCookie(lifetime.request.headers.get('cookie'), cookieName(target));
    if (handle === null || !/^[A-Za-z0-9_-]{43}$/u.test(handle)) return null;
    const record = await lifetime.run(() =>
      options.store!.read(digest(handle), lifetime.request.signal),
    );
    if (
      record?.subject !== principal.subject ||
      record.sessionId !== principal.sessionId ||
      targetKey(record.target) !== targetKey(target) ||
      !current(record.expiresAt, options.now()) ||
      !current(principal.expiresAt, options.now()) ||
      !current(target.expiresAt, options.now())
    ) {
      return null;
    }
    const verdict = await lifetime.run(() =>
      authorizeRequest(lifetime.request, {
        type: 'verifier',
        now: options.now,
        verify: () => ({
          subject: principal.subject,
          expiresAt: Math.min(record.expiresAt, principal.expiresAt, target.expiresAt),
          scope: {
            audience: target.audience,
            path: target.path,
            ...(target.locale === undefined ? {} : { locale: target.locale }),
            payload: {
              serverURL: target.serverURL,
              ...(target.apiRoute === undefined ? {} : { apiRoute: target.apiRoute }),
              document: target.document,
              maxDepth: target.depth,
            },
          },
          payloadHeaders: principal.payloadHeaders,
        }),
      }),
    );
    return verdict.authorized ? { context: verdict.context, target } : null;
  }

  async function withGrant<T>(
    request: PreviewAuthorizationRequest,
    use: (grant: ContinuationGrant, work: ContinuationWork) => T | PromiseLike<T>,
  ): Promise<T | null> {
    const lifetime = requestLifetime(request, totalTimeoutMs);
    try {
      const grant = await authorize(lifetime);
      if (grant === null) return null;
      const checkGrant = (): void => {
        if (!current(grant.context.expiresAt ?? 0, options.now())) throw new ContinuationStopped();
      };
      const work: ContinuationWork = {
        signal: lifetime.request.signal,
        run: <Value>(action: () => Value | PromiseLike<Value>) =>
          lifetime.run(async () => {
            checkGrant();
            const value = await action();
            checkGrant();
            return value;
          }),
      };
      return await work.run(() => use(grant, work));
    } catch {
      return null;
    } finally {
      lifetime.dispose();
    }
  }

  return {
    async exchange(request: Request): Promise<Response> {
      if (request.method !== 'GET') return response(405);
      const lifetime = requestLifetime(request, totalTimeoutMs);
      try {
        const prepared = await prepare(lifetime);
        const store = options.store;
        if (prepared === null || store === undefined) return response(403);
        const { principal, target } = prepared;
        const verdict = await lifetime.run(() =>
          authorizeRequest(lifetime.request, {
            type: 'signed-token',
            secret: options.secret,
            audience: options.audience,
            ...(options.transport === undefined ? {} : { transport: options.transport }),
            // Verification may ignore abort while awaiting crypto. Recheck before
            // it can start a late consume, not only after the verdict returns.
            replay: {
              consume: (id, expiry) =>
                lifetime.run(() => store.consume(id, expiry, lifetime.request.signal)),
            },
            now: options.now,
            locale: () => target.locale,
            crypto: webcrypto as unknown as SubtleCryptoLike,
          }),
        );
        if (!verdict.authorized) return response(403);
        const context = verdict.context;
        if (
          context.subject !== principal.subject ||
          context.scope.audience !== target.audience ||
          context.scope.path !== target.path ||
          context.scope.locale !== target.locale
        ) {
          return response(403);
        }
        const expiresAt = Math.min(
          context.expiresAt ?? 0,
          principal.expiresAt,
          target.expiresAt,
          options.now() + MAX_LIFETIME_MS,
        );
        if (!current(expiresAt, options.now())) return response(403);
        const handle = randomBytes(32).toString('base64url');
        const record = Object.freeze({
          subject: principal.subject,
          sessionId: principal.sessionId,
          target,
          expiresAt,
        });
        // A throw or lost acknowledgement burns the entry. No cookie is sent
        // before publication, and no failure path restores the replay proof.
        const published: unknown = await lifetime.run(() =>
          store.publish(digest(handle), record, lifetime.request.signal),
        );
        if (published !== true || !current(expiresAt, options.now())) {
          return response(403);
        }
        const query = new URLSearchParams({ preview: 'true' });
        if (target.locale !== undefined) query.set('locale', target.locale);
        // The store's millisecond expiry is authoritative even if the browser
        // retains a sub-second grant's cookie for the rest of that second.
        const age = Math.ceil((expiresAt - options.now()) / 1_000);
        lifetime.check();
        return response(303, {
          location: `${target.path}?${query.toString()}`,
          'set-cookie': `${cookieName(target)}=${handle}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`,
        });
      } catch (error) {
        return response(error instanceof ContinuationStopped ? 403 : 503);
      } finally {
        lifetime.dispose();
      }
    },
    authorize(request: PreviewAuthorizationRequest): Promise<ContinuationGrant | null> {
      return withGrant(request, (grant) => grant);
    },
    withGrant,
  };
}
