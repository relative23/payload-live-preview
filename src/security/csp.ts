/**
 * Content-Security-Policy helpers.
 *
 * Two responsibilities:
 *
 *   1. Generate cryptographic nonces so consumers can opt into a strict
 *      `script-src 'nonce-...'` policy and avoid `'unsafe-inline'`.
 *   2. Build the `frame-ancestors` directive value, restricting which
 *      origins may embed the preview page in an iframe.
 *
 * Both functions are isomorphic — they work in browsers, Node, and
 * edge runtimes that expose Web Crypto via `globalThis.crypto`.
 *
 * @module @security/csp
 */

/**
 * Default byte-length for nonces. 16 bytes → 22 base64url characters,
 * which exceeds the 128-bit entropy threshold recommended by OWASP.
 */
const DEFAULT_NONCE_BYTES = 16;

/**
 * Minimal Web-Crypto surface area we actually call. The full `Crypto`
 * type drags in browser-only declarations that don't typecheck cleanly
 * against Node's `webcrypto` shape — this narrower interface accepts
 * both without an unsafe cast.
 */
interface WebCryptoLike {
  getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;
}

let cryptoOverride: WebCryptoLike | undefined;

/**
 * Inject a Web Crypto implementation to use when `globalThis.crypto`
 * is unavailable.
 *
 * Node.js exposed `globalThis.crypto` globally starting with v19. On
 * Node 18 (still LTS at time of writing) consumers can flip the
 * `--experimental-global-webcrypto` flag *or* call this function once
 * at startup:
 *
 *   ```ts
 *   import { webcrypto } from 'node:crypto';
 *   import { setCspCrypto } from 'payload-live-preview';
 *   setCspCrypto(webcrypto as { getRandomValues: typeof webcrypto.getRandomValues });
 *   ```
 *
 * Browser bundles never need to call this — `globalThis.crypto` is
 * always present there, and the override only matters when the global
 * is missing.
 *
 * Pass `null` to clear a previous override (mostly useful for tests).
 */
export function setCspCrypto(crypto: WebCryptoLike | null): void {
  cryptoOverride = crypto ?? undefined;
}

/**
 * Generate a base64url-encoded cryptographic nonce.
 *
 * Uses `crypto.getRandomValues` everywhere — falls back to throwing
 * if no Web Crypto implementation is available, because a predictable
 * nonce would silently defeat the entire CSP.
 *
 * @param bytes Number of random bytes (defaults to 16 → 128-bit entropy).
 */
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

/**
 * Sources allowed in the `frame-ancestors` directive.
 *
 * Conceptually a union of `'self'`, `'none'`, or an explicit origin
 * string. TypeScript collapses literal-vs-string unions, so we expose
 * a `string` alias and document the special values.
 */
export type FrameAncestorSource = string;

export interface FrameAncestorsOptions {
  readonly self?: boolean;
  readonly origins?: readonly string[];
  readonly allowNone?: boolean;
}

/**
 * Build the value for `frame-ancestors` in a `Content-Security-Policy`
 * header.
 *
 * Returns `'none'` if `allowNone: true` and no other sources are
 * provided. Otherwise concatenates `'self'` (if requested) with the
 * given origins, deduplicating and trimming entries.
 *
 * @example
 *   `frame-ancestors ${buildFrameAncestors({ self: true, origins: [adminUrl] })}`
 */
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
 * Build a `script-src` value that permits a single nonce plus optional
 * extra sources.
 *
 * `'strict-dynamic'` is **opt-in**: under CSP 3 it makes browsers
 * ignore `'self'` and every host source in the directive, so any
 * parser-inserted script without a nonce (framework hydration scripts,
 * consumer `<script>` tags) would be blocked. Only enable it when every
 * script on the page carries the nonce.
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

/**
 * How a directive is merged into an existing CSP header value.
 *
 *   - `union` (default) — the new sources are added to the existing
 *     directive's sources (deduplicated). An existing `'none'` is
 *     dropped when real sources are added, since `'none'` may not be
 *     combined with other sources.
 *   - `replace` — the new value overwrites the existing directive.
 */
export interface CspDirectiveMerge {
  readonly value: string;
  readonly mode?: 'union' | 'replace';
}

/**
 * Merge directives into an existing `Content-Security-Policy` header
 * value without clobbering what a consumer (or another middleware)
 * already configured. Directives not mentioned in `additions` pass
 * through untouched; new directives are appended.
 *
 * This is the single CSP-merge implementation shared by every adapter.
 */
export function mergeCspHeader(
  existing: string,
  additions: Readonly<Record<string, string | CspDirectiveMerge>>,
): string {
  const directives = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex < 0) {
      directives.set(trimmed.toLowerCase(), '');
      continue;
    }
    directives.set(
      trimmed.slice(0, spaceIndex).toLowerCase(),
      trimmed.slice(spaceIndex + 1).trim(),
    );
  }

  for (const [rawName, rawAddition] of Object.entries(additions)) {
    const name = rawName.toLowerCase();
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
    for (const token of [...current.split(/\s+/), ...addition.value.split(/\s+/)]) {
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
