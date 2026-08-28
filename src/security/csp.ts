/**
 * Content-Security-Policy helpers: nonce generation, directive builders and
 * the header merge every adapter uses. Isomorphic; needs only Web Crypto.
 */

const DEFAULT_NONCE_BYTES = 16;

/** CSP3's exact whitespace set: HTAB, LF, FF, CR, and SPACE. */
const CSP_ASCII_WHITESPACE = /[\t\n\f\r ]+/;
const CSP_EDGE_ASCII_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** CSP names are ASCII; Unicode case folding must not create directives. */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** The one Web Crypto method this module calls; accepts Node's `webcrypto` without a cast. */
interface WebCryptoLike {
  getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;
}

let cryptoOverride: WebCryptoLike | undefined;

/** Supply a Web Crypto implementation for runtimes without `globalThis.crypto`; `null` clears it. */
export function setCspCrypto(crypto: WebCryptoLike | null): void {
  cryptoOverride = crypto ?? undefined;
}

/** A base64url nonce of `bytes` random bytes (default 16); throws without Web Crypto, since a predictable nonce silently defeats the CSP. */
export function generateCspNonce(bytes: number = DEFAULT_NONCE_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < 8) {
    throw new RangeError(`generateCspNonce: bytes must be an integer >= 8, got ${String(bytes)}`);
  }
  const crypto = resolveCrypto();
  if (!crypto) {
    throw new Error(
      'generateCspNonce: Web Crypto is unavailable. On Node 18 call setCspCrypto(webcrypto) ' +
        "once at startup, or run with --experimental-global-webcrypto. We won't fabricate " +
        'a predictable nonce — that would silently defeat the entire CSP.',
    );
  }
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

function resolveCrypto(): WebCryptoLike | undefined {
  if (cryptoOverride?.getRandomValues) return cryptoOverride;
  const fromGlobal = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (fromGlobal?.getRandomValues) return fromGlobal;
  return undefined;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A `frame-ancestors` source: `'self'`, `'none'`, or an origin. */
export type FrameAncestorSource = string;

export interface FrameAncestorsOptions {
  readonly self?: boolean;
  readonly origins?: readonly string[];
  readonly allowNone?: boolean;
}

/** The `frame-ancestors` value: `'self'` and the origins, deduplicated; `'none'` when empty. */
export function buildFrameAncestors(options: FrameAncestorsOptions = {}): string {
  const { self = true, origins = [], allowNone = false } = options;
  const seen = new Set<string>();
  const out: FrameAncestorSource[] = [];
  if (allowNone && !self && origins.length === 0) return "'none'";
  if (self) {
    out.push("'self'");
    seen.add("'self'");
  }
  for (const origin of origins) {
    const trimmed = origin.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length > 0 ? out.join(' ') : "'none'";
}

/**
 * A `script-src` value permitting one nonce plus optional extra sources.
 * `'strict-dynamic'` is opt-in: it makes CSP 3 browsers ignore `'self'` and
 * host sources, so every script on the page must then carry the nonce.
 */
export function buildScriptSrcWithNonce(
  nonce: string,
  options: {
    readonly self?: boolean;
    readonly extra?: readonly string[];
    readonly strictDynamic?: boolean;
  } = {},
): string {
  if (nonce.length === 0) throw new RangeError('buildScriptSrcWithNonce: nonce is empty');
  const { self = true, extra = [], strictDynamic = false } = options;
  const parts: string[] = [];
  if (self) parts.push("'self'");
  parts.push(`'nonce-${nonce}'`);
  if (strictDynamic) parts.push("'strict-dynamic'");
  for (const e of extra) {
    const trimmed = e.trim();
    if (trimmed.length > 0) parts.push(trimmed);
  }
  return parts.join(' ');
}

/** `union` (default) adds sources to an existing directive; `replace` overwrites it. */
export interface CspDirectiveMerge {
  readonly value: string;
  readonly mode?: 'union' | 'replace';
}

/**
 * Merge directives into an existing `Content-Security-Policy` header value.
 * Commas separate policies (that is how `Headers.get()` joins repeated
 * headers); each is merged, because a browser enforces every policy and
 * widening only the last would leave the others blocking.
 */
export function mergeCspHeader(
  existing: string,
  additions: Readonly<Record<string, string | CspDirectiveMerge>>,
): string {
  const policies = existing.split(',').filter((policy) => policy.trim().length > 0);
  if (policies.length === 0) return mergeCspPolicy('', additions);
  return policies.map((policy) => mergeCspPolicy(policy, additions)).join(', ');
}

function mergeCspPolicy(
  existing: string,
  additions: Readonly<Record<string, string | CspDirectiveMerge>>,
): string {
  const directives = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.replace(CSP_EDGE_ASCII_WHITESPACE, '');
    if (trimmed.length === 0) continue;
    const whitespaceIndex = trimmed.search(CSP_ASCII_WHITESPACE);
    const name = asciiLowercase(whitespaceIndex < 0 ? trimmed : trimmed.slice(0, whitespaceIndex));
    // CSP3 §2.2.1: a user agent ignores later duplicates, so a looser
    // duplicate must not become the policy that is serialized.
    if (directives.has(name)) continue;
    const value =
      whitespaceIndex < 0
        ? ''
        : trimmed.slice(whitespaceIndex).replace(CSP_EDGE_ASCII_WHITESPACE, '');
    directives.set(name, value);
  }

  for (const [rawName, rawAddition] of Object.entries(additions)) {
    const name = asciiLowercase(rawName);
    const addition: CspDirectiveMerge =
      typeof rawAddition === 'string' ? { value: rawAddition } : rawAddition;
    const mode = addition.mode ?? 'union';
    const current = directives.get(name);
    if (mode === 'replace' || current === undefined || current.length === 0) {
      directives.set(name, addition.value);
      continue;
    }
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const token of [
      ...current.split(CSP_ASCII_WHITESPACE),
      ...addition.value.split(CSP_ASCII_WHITESPACE),
    ]) {
      if (token.length === 0 || seen.has(token)) continue;
      seen.add(token);
      merged.push(token);
    }
    // `'none'` cannot coexist with other sources.
    const withoutNone = merged.filter((token) => token !== "'none'");
    directives.set(name, (withoutNone.length > 0 ? withoutNone : merged).join(' '));
  }

  const out: string[] = [];
  for (const [name, value] of directives) {
    out.push(value.length === 0 ? name : `${name} ${value}`);
  }
  return out.join('; ');
}
