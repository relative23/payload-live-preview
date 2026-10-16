/**
 * The `payload-session` strategy: forward exactly one named cookie to
 * `GET <serverURL>/api/<usersSlug>/me` and authorize when a user comes back.
 * A cookie-only request preserves working Payload 2 sessions. When `/me`
 * reports no user, one retry adds an `Origin` for Payload 3's CSRF check.
 */

import { createAuthorizedPreviewContext } from '@/types/authorized-preview';
import {
  PreviewConfigurationError,
  refused,
  type PreviewAuthorization,
  type PreviewAuthorizationRequest,
} from './preview-verdict';

/** A `fetch`-compatible function, injectable for tests. */
export type FetchLike = (
  input: string,
  init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface PayloadSessionStrategy {
  readonly type: 'payload-session';
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** Auth collection slug; `users` unless the project renamed it. */
  readonly usersSlug?: string;
  /** Cookie name; Payload's default is `payload-token`. */
  readonly cookieName?: string;
  /**
   * Send this listed origin with the cookie from the first request. Without
   * it, try the existing cookie-only request, then the origin of `serverURL`
   * once when `/me` reports a null user. Draft reads keep the accepted headers.
   */
  readonly origin?: string;
  /** Upper bound for the `/me` round trip. Below 250 ms is raised to 250 ms; default 3000. */
  readonly timeoutMs?: number;
  /** Longest cookie value accepted; longer ones are refused as `missing-credential`. Default 4096. */
  readonly maxCookieLength?: number;
  readonly fetch?: FetchLike;
  /** Clock, Unix milliseconds. Injectable for tests. */
  readonly now?: () => number;
}

const DEFAULT_USERS_SLUG = 'users';
const DEFAULT_COOKIE_NAME = 'payload-token';
const DEFAULT_TIMEOUT_MS = 3_000;
const MIN_TIMEOUT_MS = 250;
const DEFAULT_MAX_COOKIE_LENGTH = 4_096;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9._~-]+$/;
/** Below this an `exp` is Unix seconds; a millisecond timestamp passed it in 1973. */
const SECONDS_CEILING = 1e11;

/**
 * Exactly one value for `name`, or `null` when absent, empty, over `maxLength`
 * or repeated — a repeated cookie is ambiguous and is refused, not guessed.
 */
export function extractCookie(
  header: string | null,
  name: string,
  maxLength: number = DEFAULT_MAX_COOKIE_LENGTH,
): string | null {
  if (header === null || header.length === 0) return null;
  const prefix = `${name}=`;
  const values: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) values.push(trimmed.slice(prefix.length));
  }
  if (values.length !== 1) return null;
  const value = values[0] ?? '';
  // A JWT is `[A-Za-z0-9._~-]`; anything else must not be forwarded in a header.
  if (value.length === 0 || value.length > maxLength || !COOKIE_VALUE_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function cookieNameFor(configured: string | undefined): string {
  const name = configured ?? DEFAULT_COOKIE_NAME;
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new PreviewConfigurationError(
      `payload-live-preview: cookie name "${name}" is not a valid cookie-name token`,
    );
  }
  return name;
}

/** The origin of an absolute http(s) URL; `option` names it in the error. */
function httpOriginFor(value: string, option: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PreviewConfigurationError(
      `payload-live-preview: ${option} "${value}" is not an absolute URL`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PreviewConfigurationError(
      `payload-live-preview: ${option} must be http(s), got "${url.protocol}"`,
    );
  }
  return url.origin;
}

export async function authorizeSession(
  request: PreviewAuthorizationRequest,
  strategy: PayloadSessionStrategy,
): Promise<PreviewAuthorization> {
  const cookieName = cookieNameFor(strategy.cookieName);
  const origin = httpOriginFor(strategy.serverURL, 'serverURL');
  const sentOrigin =
    strategy.origin === undefined ? undefined : httpOriginFor(strategy.origin, 'origin');
  const value = extractCookie(
    request.headers.get('cookie'),
    cookieName,
    strategy.maxCookieLength ?? DEFAULT_MAX_COOKIE_LENGTH,
  );
  if (value === null) return refused('missing-credential');
  const now = strategy.now ?? Date.now;
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // Retain AbortSignal.timeout's refusal of non-integral or non-finite values.
  if (!Number.isSafeInteger(timeoutMs)) return refused('unavailable');
  const fetchImpl: FetchLike = strategy.fetch ?? globalThis.fetch;
  const usersSlug = encodeURIComponent(strategy.usersSlug ?? DEFAULT_USERS_SLUG);
  const forwarded = `${cookieName}=${value}`;
  let payloadHeaders: Record<string, string> = { cookie: forwarded };
  if (sentOrigin !== undefined) payloadHeaders['origin'] = sentOrigin;
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(request.signal?.reason);
  };
  const isAborted = (): boolean => controller.signal.aborted;
  request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted === true) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let body: unknown;
  try {
    if (isAborted()) return refused('unavailable');
    timer = setTimeout(() => {
      controller.abort(new DOMException('The operation timed out', 'TimeoutError'));
    }, timeoutMs);
    for (let attempt = 0; attempt < 2; attempt++) {
      // `depth=0`: the verdict needs the user's id, not its populated relations.
      const response = await fetchImpl(`${origin}/api/${usersSlug}/me?depth=0`, {
        headers: { ...payloadHeaders, accept: 'application/json' },
        signal: controller.signal,
      });
      if (isAborted()) return refused('unavailable');
      if (!response.ok) return refused(response.status === 401 ? 'invalid' : 'unavailable');
      body = await response.json();
      if (isAborted()) return refused('unavailable');
      // Payload 2 accepts an absent Origin; adding one unconditionally can
      // reject its valid session when only the frontend is in the CSRF list.
      if (
        attempt !== 0 ||
        sentOrigin !== undefined ||
        typeof body !== 'object' ||
        body === null ||
        (body as { user?: unknown }).user !== null
      ) {
        break;
      }
      payloadHeaders = { cookie: forwarded, origin };
    }
  } catch {
    return refused('unavailable');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
  }
  const user = readUser(body, strategy.usersSlug ?? DEFAULT_USERS_SLUG);
  if (user === null) return refused('invalid');
  const expiresAt = readExpiry(body);
  if (expiresAt !== undefined && expiresAt <= now()) return refused('expired');
  return {
    authorized: true,
    outcome: 'authorized',
    context: createAuthorizedPreviewContext({
      strategy: 'payload-session',
      subject: user,
      authorizedAt: now(),
      expiresAt,
      scope: {},
      payloadHeaders,
    }),
  };
}

/** The user id from a `/me` body, or `null` when absent or from another auth collection — Payload answers `/me` for every one of them. */
function readUser(body: unknown, usersSlug: string): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const user = (body as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return null;
  const collection =
    (body as { collection?: unknown }).collection ?? (user as { collection?: unknown }).collection;
  if (collection !== undefined && collection !== usersSlug) return null;
  const id = (user as { id?: unknown }).id;
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/** `/me` reports `exp` in Unix seconds; units are decided by magnitude so an expired millisecond value stays expired. */
function readExpiry(body: unknown): number | undefined {
  const exp = (body as { exp?: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return undefined;
  return exp < SECONDS_CEILING ? exp * 1000 : exp;
}
