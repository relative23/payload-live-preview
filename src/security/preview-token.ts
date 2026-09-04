/**
 * The `signed-token` strategy: a short-lived HMAC-SHA256 token minted by the
 * Payload side and verified by the site. Format and bindings: ADR 0006 §3.
 */

import { createAuthorizedPreviewContext } from '@/types/authorized-preview';
import {
  PreviewConfigurationError,
  refused,
  type PreviewAuthorization,
  type PreviewAuthorizationRequest,
} from './preview-verdict';

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

/** Where a signed token is read from on the request. */
export type PreviewTokenTransport =
  | { readonly kind: 'query'; readonly param?: string }
  | { readonly kind: 'header'; readonly name?: string };

/**
 * Optional replay store. Not shipped: a per-process memory is useless behind
 * a load balancer, so the store is a deployment decision.
 */
export interface PreviewTokenReplayStore {
  isUsed(id: string): Promise<boolean> | boolean;
  markUsed(id: string, expiresAt: number): Promise<void> | void;
}

export interface SignedTokenStrategy {
  readonly type: 'signed-token';
  /** Shared secret, at least 32 bytes; shorter ones are refused on first use. */
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

/** What `issuePreviewToken()` binds a token to. */
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

const DEFAULT_PURPOSE = 'live-preview';
const DEFAULT_QUERY_PARAM = 'previewToken';
const DEFAULT_HEADER_NAME = 'x-preview-token';
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_TTL_MS = 60 * 60_000;
const MIN_SECRET_BYTES = 32;
const TOKEN_VERSION = 'v1';
/** A real token is a few hundred bytes. */
const MAX_TOKEN_LENGTH = 4_096;

// Lazy: a module-scope `new TextEncoder()` is a side effect a bundler must keep.
let cachedEncoder: TextEncoder | undefined;
function encoder(): TextEncoder {
  cachedEncoder ??= new TextEncoder();
  return cachedEncoder;
}

function secretBytes(secret: string | Uint8Array): Uint8Array {
  const bytes = typeof secret === 'string' ? encoder().encode(secret) : secret;
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new PreviewConfigurationError(
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

/** Mint a preview token on the Payload side; pair with `buildLivePreviewUrl`. */
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

export async function authorizeToken(
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
