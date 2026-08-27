/**
 * Authorized preview context: the one verdict every privileged preview
 * decision is keyed on.
 *
 * Preview *intent* (`?preview=true`, an iframe fetch destination, an admin
 * referer) is chosen by the client and proves nothing. What proves an editor
 * is looking is a verification the application can stand behind — a Payload
 * session, a short-lived signed token, or the application's own verifier —
 * and this module turns any of the three into one branded value,
 * {@link AuthorizedPreviewContext}, that the adapters, the draft helpers and
 * the binding DSL accept as their gate.
 *
 * The threat model, the token format and why each binding exists are in
 * `docs/architecture/0006-authorized-preview-context.md`. This file is that
 * record made executable; when the two disagree the record is wrong and must
 * be corrected first.
 *
 * Isomorphic and dependency-free: `fetch`, `SubtleCrypto` and `TextEncoder`
 * are the only platform surfaces, all injectable for tests and for runtimes
 * that expose them under another name.
 *
 * @module @security/preview-authorization
 */

import {
  createAuthorizedPreviewContext,
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type PreviewAuthorizationStrategyName,
} from '@/types/authorized-preview';

export {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type PreviewAuthorizationStrategyName,
};

/** Why a request was refused. `'authorized'` is the one non-refusal. */
export type PreviewAuthorizationOutcome =
  | 'authorized'
  | 'missing-credential'
  | 'invalid'
  | 'expired'
  | 'wrong-audience'
  | 'wrong-path'
  | 'wrong-locale'
  | 'wrong-purpose'
  | 'replayed'
  | 'unavailable';

/** The result of {@link authorizePreviewRequest}: a verdict, never an exception. */
export type PreviewAuthorization =
  | {
      readonly authorized: true;
      readonly outcome: 'authorized';
      readonly context: AuthorizedPreviewContext;
    }
  | {
      readonly authorized: false;
      readonly outcome: Exclude<PreviewAuthorizationOutcome, 'authorized'>;
      readonly context: null;
    };

/** The request shape every strategy reads: a URL and a header getter. */
export interface PreviewAuthorizationRequest {
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

/** A `fetch`-compatible function, injectable for tests. */
export type FetchLike = (
  input: string,
  init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

/** The subset of Web Crypto the token strategy needs, injectable for environments that expose it elsewhere. */
export interface SubtleCryptoLike {
  readonly subtle: {
    importKey(
      format: 'raw',
      keyData: Uint8Array,
      algorithm: { readonly name: 'HMAC'; readonly hash: 'SHA-256' },
      extractable: false,
      keyUsages: readonly ('sign' | 'verify')[],
    ): Promise<CryptoKey>;
    sign(algorithm: 'HMAC', key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
    verify(
      algorithm: 'HMAC',
      key: CryptoKey,
      signature: Uint8Array,
      data: Uint8Array,
    ): Promise<boolean>;
  };
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/**
 * Verify a Payload session: forward exactly one named cookie to
 * `GET <serverURL>/api/<usersSlug>/me` and authorize when a user comes back.
 */
export interface PayloadSessionStrategy {
  readonly type: 'payload-session';
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** Auth collection slug; `users` unless the project renamed it. */
  readonly usersSlug?: string;
  /** Cookie name; Payload's default is `payload-token`. */
  readonly cookieName?: string;
  /** Upper bound for the `/me` round trip. Below 250 ms is raised to 250 ms; default 3000. */
  readonly timeoutMs?: number;
  /** Longest cookie value accepted; longer ones are refused as `invalid`. Default 4096. */
  readonly maxCookieLength?: number;
  readonly fetch?: FetchLike;
  /** Clock, Unix milliseconds. Injectable for tests. */
  readonly now?: () => number;
}

/** Where a signed token is read from on the request. */
export type PreviewTokenTransport =
  | { readonly kind: 'query'; readonly param?: string }
  | { readonly kind: 'header'; readonly name?: string };

/**
 * Optional replay store for the token strategy. Not shipped with the
 * package: a per-process memory is useless behind a load balancer, so the
 * store is a deployment decision. `markUsed` receives the expiry so entries
 * can be evicted.
 */
export interface PreviewTokenReplayStore {
  isUsed(id: string): Promise<boolean> | boolean;
  markUsed(id: string, expiresAt: number): Promise<void> | void;
}

/** Verify a short-lived HMAC-SHA256 token issued by {@link issuePreviewToken}. */
export interface SignedTokenStrategy {
  readonly type: 'signed-token';
  /** Shared secret. At least 32 bytes; shorter secrets are refused at strategy construction. */
  readonly secret: string | Uint8Array;
  /** The site origin tokens must name, e.g. `https://www.example.com`. */
  readonly audience: string;
  /** Purpose string tokens must carry. Default `live-preview`. */
  readonly purpose?: string;
  /** Default: query parameter `previewToken`. */
  readonly transport?: PreviewTokenTransport;
  /** Resolve the request's locale for the `loc` binding. Unset: tokens with `loc` are refused as `wrong-locale`. */
  readonly locale?: (request: PreviewAuthorizationRequest) => string | undefined;
  readonly replay?: PreviewTokenReplayStore;
  readonly crypto?: SubtleCryptoLike;
  readonly now?: () => number;
}

/** Claims a consumer verifier returns for a request it accepts. */
export interface PreviewVerifierClaims {
  readonly subject?: string;
  readonly expiresAt?: number;
  readonly scope?: AuthorizedPreviewScope;
  readonly payloadHeaders?: Readonly<Record<string, string>>;
}

/**
 * The application's own verification. Return claims to authorize, `null` to
 * refuse; throwing is reported as `unavailable`, never as authorized.
 */
export interface VerifierStrategy {
  readonly type: 'verifier';
  readonly verify: (
    request: PreviewAuthorizationRequest,
  ) => Promise<PreviewVerifierClaims | null> | PreviewVerifierClaims | null;
  readonly now?: () => number;
}

export type PreviewAuthorizationStrategy =
  PayloadSessionStrategy | SignedTokenStrategy | VerifierStrategy;

const DEFAULT_USERS_SLUG = 'users';
const DEFAULT_COOKIE_NAME = 'payload-token';
const DEFAULT_TIMEOUT_MS = 3_000;
const MIN_TIMEOUT_MS = 250;
const DEFAULT_MAX_COOKIE_LENGTH = 4_096;
const DEFAULT_PURPOSE = 'live-preview';
const DEFAULT_QUERY_PARAM = 'previewToken';
const DEFAULT_HEADER_NAME = 'x-preview-token';
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_TTL_MS = 60 * 60_000;
const MIN_SECRET_BYTES = 32;
const TOKEN_VERSION = 'v1';
/** Longest token accepted before parsing; a real one is a few hundred bytes. */
const MAX_TOKEN_LENGTH = 4_096;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9._~-]+$/;

function refused(
  outcome: Exclude<PreviewAuthorizationOutcome, 'authorized'>,
): PreviewAuthorization {
  return { authorized: false, outcome, context: null };
}

/**
 * Decide whether `request` is an authorized preview under `strategy`.
 *
 * Never throws for a refusal and never throws for a failing dependency: a
 * network error, a timeout, a verifier that threw, or a missing crypto
 * implementation all resolve to `{ authorized: false, outcome: 'unavailable' }`.
 * The only exceptions are configuration errors — a secret that is too short,
 * a malformed cookie name — which are raised when the strategy is first used,
 * because a misconfiguration must be loud in development, not quiet in
 * production.
 */
export async function authorizePreviewRequest(
  request: PreviewAuthorizationRequest,
  strategy: PreviewAuthorizationStrategy,
): Promise<PreviewAuthorization> {
  switch (strategy.type) {
    case 'payload-session':
      return authorizeSession(request, strategy);
    case 'signed-token':
      return authorizeToken(request, strategy);
    case 'verifier':
      return authorizeVerifier(request, strategy);
  }
}

// ── Payload session ────────────────────────────────────────────────────────

/**
 * Exactly one value for `name` from a `Cookie` header, or `null` when it is
 * absent, repeated, empty, or longer than `maxLength`. A repeated cookie is
 * ambiguous — two paths, two domains, or an injection attempt — and is refused
 * rather than guessed at.
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
  // A JWT is `[A-Za-z0-9._~-]`; anything else is not a Payload token and must
  // not be forwarded in a header the package composes.
  if (value.length === 0 || value.length > maxLength || !COOKIE_VALUE_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function cookieNameFor(configured: string | undefined): string {
  const name = configured ?? DEFAULT_COOKIE_NAME;
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new Error(`payload-live-preview: cookie name "${name}" is not a valid cookie-name token`);
  }
  return name;
}

function serverOriginFor(serverURL: string): string {
  let url: URL;
  try {
    url = new URL(serverURL);
  } catch {
    throw new Error(`payload-live-preview: serverURL "${serverURL}" is not an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`payload-live-preview: serverURL must be http(s), got "${url.protocol}"`);
  }
  return url.origin;
}

async function authorizeSession(
  request: PreviewAuthorizationRequest,
  strategy: PayloadSessionStrategy,
): Promise<PreviewAuthorization> {
  const cookieName = cookieNameFor(strategy.cookieName);
  const origin = serverOriginFor(strategy.serverURL);
  const value = extractCookie(
    request.headers.get('cookie'),
    cookieName,
    strategy.maxCookieLength ?? DEFAULT_MAX_COOKIE_LENGTH,
  );
  if (value === null) return refused('missing-credential');
  const now = strategy.now ?? Date.now;
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, strategy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const fetchImpl: FetchLike = strategy.fetch ?? globalThis.fetch;
  const usersSlug = encodeURIComponent(strategy.usersSlug ?? DEFAULT_USERS_SLUG);
  const forwarded = `${cookieName}=${value}`;
  let body: unknown;
  try {
    // `depth=0`: the verdict needs the user's id, not its populated relations.
    const response = await fetchImpl(`${origin}/api/${usersSlug}/me?depth=0`, {
      headers: { cookie: forwarded, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return refused(response.status === 401 ? 'invalid' : 'unavailable');
    body = await response.json();
  } catch {
    return refused('unavailable');
  }
  const user = readUser(body, strategy.usersSlug ?? DEFAULT_USERS_SLUG);
  if (user === null) return refused('invalid');
  const expiresAt = readExpiry(body, now());
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
      payloadHeaders: { cookie: forwarded },
    }),
  };
}

/**
 * The user id from a `/me` body, as a string, or `null` when there is no
 * user or the user belongs to a different collection than the one asked —
 * Payload answers `/me` for every auth collection, and a session of another
 * one must not pass as an editor.
 */
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

/** Payload's `/me` reports `exp` in Unix seconds; a missing or absurd value means unknown. */
function readExpiry(body: unknown, now: number): number | undefined {
  const exp = (body as { exp?: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return undefined;
  const ms = exp * 1000;
  // Guard against a server that already reports milliseconds.
  return exp > now ? exp : ms;
}

// ── Signed token ───────────────────────────────────────────────────────────

/** What {@link issuePreviewToken} binds a token to. */
export interface PreviewTokenClaims {
  /** The site origin the token is for. */
  readonly audience: string;
  /** Request pathname the token opens. Recommended; omit only for a single-page preview. */
  readonly path?: string;
  readonly locale?: string;
  readonly subject?: string;
  readonly purpose?: string;
  /** Lifetime in milliseconds. Default ten minutes; capped at one hour. */
  readonly ttlMs?: number;
}

export interface IssuePreviewTokenOptions {
  readonly secret: string | Uint8Array;
  readonly crypto?: SubtleCryptoLike;
  readonly now?: () => number;
}

interface WireClaims {
  readonly v: 1;
  readonly aud: string;
  readonly pth?: string;
  readonly loc?: string;
  readonly sub?: string;
  readonly pur: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

// Created on first use: an eager `new TextEncoder()` at module scope is a side
// effect a bundler must keep, and with it this whole module, in a consumer that
// imports an unrelated symbol from the root barrel.
let cachedEncoder: TextEncoder | undefined;
function encoder(): TextEncoder {
  cachedEncoder ??= new TextEncoder();
  return cachedEncoder;
}

function secretBytes(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === 'string' ? encoder().encode(secret) : secret;
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `payload-live-preview: the preview token secret must be at least ${String(MIN_SECRET_BYTES)} bytes`,
    );
  }
  return bytes;
}

function cryptoFor(configured: SubtleCryptoLike | undefined): SubtleCryptoLike | undefined {
  if (configured !== undefined) return configured;
  const candidate = (globalThis as { crypto?: unknown }).crypto;
  if (typeof (candidate as { subtle?: unknown } | undefined)?.subtle === 'object') {
    return candidate as SubtleCryptoLike;
  }
  return undefined;
}

async function hmacKey(crypto: SubtleCryptoLike, secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  const padded =
    text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * Mint a preview token on the Payload side. Pair with `buildLivePreviewUrl`
 * so the admin's iframe URL carries a token bound to that page, that site,
 * and the next few minutes — and nothing else.
 */
export async function issuePreviewToken(
  claims: PreviewTokenClaims,
  options: IssuePreviewTokenOptions,
): Promise<string> {
  const crypto = cryptoFor(options.crypto);
  if (crypto === undefined) {
    throw new Error('payload-live-preview: no Web Crypto implementation available to sign tokens');
  }
  const secret = secretBytes(options.secret);
  const now = (options.now ?? Date.now)();
  const ttl = Math.min(MAX_TTL_MS, Math.max(1, claims.ttlMs ?? DEFAULT_TTL_MS));
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  const wire: WireClaims = {
    v: 1,
    aud: claims.audience,
    ...(claims.path !== undefined ? { pth: claims.path } : {}),
    ...(claims.locale !== undefined ? { loc: claims.locale } : {}),
    ...(claims.subject !== undefined ? { sub: claims.subject } : {}),
    pur: claims.purpose ?? DEFAULT_PURPOSE,
    iat: now,
    exp: now + ttl,
    jti: toBase64Url(id),
  };
  const payload = toBase64Url(encoder().encode(JSON.stringify(wire)));
  const signed = `${TOKEN_VERSION}.${payload}`;
  const key = await hmacKey(crypto, secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder().encode(signed)));
  return `${signed}.${toBase64Url(signature)}`;
}

function readToken(
  request: PreviewAuthorizationRequest,
  transport: PreviewTokenTransport | undefined,
): string | null {
  if (transport?.kind === 'header') {
    return request.headers.get(transport.name ?? DEFAULT_HEADER_NAME);
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const values = url.searchParams.getAll(transport?.param ?? DEFAULT_QUERY_PARAM);
  return values.length === 1 ? (values[0] ?? null) : null;
}

function parseClaims(bytes: Uint8Array): WireClaims | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const c = parsed as Record<string, unknown>;
  const optionalString = (key: string): boolean =>
    c[key] === undefined || typeof c[key] === 'string';
  if (
    c['v'] !== 1 ||
    typeof c['aud'] !== 'string' ||
    typeof c['pur'] !== 'string' ||
    typeof c['iat'] !== 'number' ||
    typeof c['exp'] !== 'number' ||
    typeof c['jti'] !== 'string' ||
    !optionalString('pth') ||
    !optionalString('loc') ||
    !optionalString('sub')
  ) {
    return undefined;
  }
  return c as unknown as WireClaims;
}

async function authorizeToken(
  request: PreviewAuthorizationRequest,
  strategy: SignedTokenStrategy,
): Promise<PreviewAuthorization> {
  const secret = secretBytes(strategy.secret);
  const crypto = cryptoFor(strategy.crypto);
  if (crypto === undefined) return refused('unavailable');
  const token = readToken(request, strategy.transport);
  if (token === null || token.length === 0) return refused('missing-credential');
  if (token.length > MAX_TOKEN_LENGTH) return refused('invalid');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return refused('invalid');
  const payloadText = parts[1] ?? '';
  const payloadBytes = fromBase64Url(payloadText);
  const signature = fromBase64Url(parts[2] ?? '');
  if (payloadBytes === undefined || signature?.byteLength !== 32) return refused('invalid');
  let verified: boolean;
  try {
    const key = await hmacKey(crypto, secret);
    verified = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder().encode(`${TOKEN_VERSION}.${payloadText}`),
    );
  } catch {
    return refused('unavailable');
  }
  if (!verified) return refused('invalid');
  const claims = parseClaims(payloadBytes);
  if (claims === undefined) return refused('invalid');
  const now = (strategy.now ?? Date.now)();
  if (claims.exp <= now || claims.iat > claims.exp) return refused('expired');
  if (claims.aud !== strategy.audience) return refused('wrong-audience');
  if (claims.pur !== (strategy.purpose ?? DEFAULT_PURPOSE)) return refused('wrong-purpose');
  if (claims.pth !== undefined) {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return refused('invalid');
    }
    if (claims.pth !== pathname) return refused('wrong-path');
  }
  if (claims.loc !== undefined) {
    const locale = strategy.locale?.(request);
    if (locale !== claims.loc) return refused('wrong-locale');
  }
  if (strategy.replay !== undefined) {
    try {
      if (await strategy.replay.isUsed(claims.jti)) return refused('replayed');
      await strategy.replay.markUsed(claims.jti, claims.exp);
    } catch {
      return refused('unavailable');
    }
  }
  return {
    authorized: true,
    outcome: 'authorized',
    context: createAuthorizedPreviewContext({
      strategy: 'signed-token',
      subject: claims.sub,
      authorizedAt: now,
      expiresAt: claims.exp,
      scope: {
        audience: claims.aud,
        ...(claims.pth !== undefined ? { path: claims.pth } : {}),
        ...(claims.loc !== undefined ? { locale: claims.loc } : {}),
      },
      payloadHeaders: {},
    }),
  };
}

// ── Consumer verifier ──────────────────────────────────────────────────────

async function authorizeVerifier(
  request: PreviewAuthorizationRequest,
  strategy: VerifierStrategy,
): Promise<PreviewAuthorization> {
  let claims: PreviewVerifierClaims | null;
  try {
    claims = await strategy.verify(request);
  } catch {
    return refused('unavailable');
  }
  if (claims === null) return refused('invalid');
  const now = (strategy.now ?? Date.now)();
  if (claims.expiresAt !== undefined && claims.expiresAt <= now) return refused('expired');
  return {
    authorized: true,
    outcome: 'authorized',
    context: createAuthorizedPreviewContext({
      strategy: 'verifier',
      subject: claims.subject,
      authorizedAt: now,
      expiresAt: claims.expiresAt,
      scope: claims.scope ?? {},
      payloadHeaders: claims.payloadHeaders ?? {},
    }),
  };
}
