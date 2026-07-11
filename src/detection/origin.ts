/**
 * Origin detection and matching.
 *
 * Builds the set of trusted Payload admin origins and exposes a fast
 * matcher used by the message bus. Three sources are combined, in
 * precedence order:
 *
 *   1. Explicit origins passed via configuration. Always trusted.
 *   2. `document.referrer`. The browser writes the parent's origin
 *      here when the iframe is loaded; capturing it gives a zero-
 *      config production path.
 *   3. Localhost pattern (any port on `localhost` / `127.0.0.1`),
 *      enabled when development mode is detected. Replaces the
 *      legacy hand-rolled port list.
 *
 * Once the parent's origin is *confirmed* through a successful message
 * handshake, callers can call `lockOrigin()` to drop every other
 * candidate, making subsequent matches exact.
 *
 * @module @detection/origin
 */

import { getEnvVar, isDevMode, isInIframe } from './environment';

const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i;
const VALID_ORIGIN_PATTERN = /^https?:\/\/[^/?#\s]+$/i;

const ENV_VAR_NAMES = [
  'PAYLOAD_ADMIN_ORIGIN',
  'PUBLIC_PAYLOAD_ADMIN_ORIGIN',
  'NEXT_PUBLIC_PAYLOAD_ADMIN_ORIGIN',
] as const;

export interface OriginDetectorOptions {
  /** Explicit additional origins to trust. Always allowed. */
  readonly additionalOrigins?: readonly string[];
  /** Set to `false` to opt out of `document.referrer` detection. */
  readonly enableReferrerDetection?: boolean;
  /** Set to `false` to opt out of localhost-pattern matching. */
  readonly enableLocalhostMatching?: boolean;
  /**
   * Override the dev-mode detection. When `undefined`, dev mode is
   * inferred from the runtime (see `isDevMode`).
   */
  readonly forceDevMode?: boolean;
  /** Override `document.referrer` for tests. */
  readonly referrer?: string;
}

/**
 * Holds the resolved origin policy and exposes a matcher.
 *
 * The detector is stateful: it starts with the union of all candidate
 * sources, then narrows down to a single, verified origin once
 * `lockOrigin()` is called by the message bus on first valid handshake.
 */
export class OriginDetector {
  readonly #explicitOrigins: ReadonlySet<string>;
  readonly #referrerOrigin: string | undefined;
  readonly #allowLocalhost: boolean;
  readonly #referrerWasAvailable: boolean;
  #lockedOrigin: string | undefined;

  constructor(options: OriginDetectorOptions = {}) {
    const explicit = new Set<string>();
    for (const origin of options.additionalOrigins ?? []) {
      const normalised = normaliseOrigin(origin);
      if (normalised !== undefined) explicit.add(normalised);
    }
    for (const envName of ENV_VAR_NAMES) {
      const value = getEnvVar(envName);
      if (value === undefined) continue;
      for (const raw of value.split(',')) {
        const normalised = normaliseOrigin(raw);
        if (normalised !== undefined) explicit.add(normalised);
      }
    }
    this.#explicitOrigins = explicit;

    const useReferrer = options.enableReferrerDetection ?? true;
    let referrerOrigin: string | undefined;
    if (useReferrer) {
      const referrer =
        options.referrer ?? (typeof document !== 'undefined' ? document.referrer : '');
      if (referrer.length > 0) {
        try {
          const origin = new URL(referrer).origin;
          if (origin && origin !== 'null') referrerOrigin = origin;
        } catch {
          // ignore — referrer is opaque
        }
      }
    }
    this.#referrerOrigin = referrerOrigin;
    this.#referrerWasAvailable = referrerOrigin !== undefined;

    const allowLocalhost =
      (options.enableLocalhostMatching ?? true) && (options.forceDevMode ?? isDevMode());
    this.#allowLocalhost = allowLocalhost;
  }

  /**
   * Returns `true` when `origin` is trusted under the current policy.
   *
   * If an origin has been locked, only that exact value matches.
   * Otherwise the result is the union of explicit, referrer, and
   * (in dev mode) localhost-pattern matches.
   */
  matches(origin: string): boolean {
    if (origin.length === 0 || origin === 'null') return false;
    if (this.#lockedOrigin !== undefined) return origin === this.#lockedOrigin;
    if (this.#explicitOrigins.has(origin)) return true;
    if (this.#referrerOrigin !== undefined && origin === this.#referrerOrigin) return true;
    if (this.#allowLocalhost && LOCALHOST_PATTERN.test(origin)) return true;
    return false;
  }

  /**
   * Narrow the trusted set to a single origin after a successful
   * handshake. Subsequent calls to `matches()` only allow `origin`.
   *
   * Returns `true` if locking succeeded; `false` if the candidate is
   * not currently considered trusted (which would defeat the purpose
   * of locking).
   */
  lockOrigin(origin: string): boolean {
    if (!this.matches(origin)) return false;
    this.#lockedOrigin = origin;
    return true;
  }

  /**
   * Release the origin lock so any allow-listed origin is trusted
   * again until the next successful handshake. The lifecycle calls
   * this on heartbeat timeout — after the trusted parent disappears,
   * a different (still-allowed) origin should be free to reconnect.
   *
   * Returns the previously-locked origin, or `undefined` when nothing
   * was locked.
   */
  unlockOrigin(): string | undefined {
    const previous = this.#lockedOrigin;
    this.#lockedOrigin = undefined;
    return previous;
  }

  /** The currently locked origin, or `undefined`. */
  get lockedOrigin(): string | undefined {
    return this.#lockedOrigin;
  }

  /**
   * Snapshot of every origin currently allowed by the policy. Used by
   * the message bus to broadcast `ready` messages.
   *
   * Localhost pattern matches are expanded into the common dev ports
   * so the handshake can find a Payload running on its usual port.
   */
  enumerate(): string[] {
    if (this.#lockedOrigin !== undefined) return [this.#lockedOrigin];
    const result = new Set<string>(this.#explicitOrigins);
    if (this.#referrerOrigin !== undefined) result.add(this.#referrerOrigin);
    if (this.#allowLocalhost) {
      for (const port of LOCALHOST_HANDSHAKE_PORTS) {
        result.add(`http://localhost:${String(port)}`);
        result.add(`http://127.0.0.1:${String(port)}`);
      }
    }
    return [...result];
  }

  /**
   * Reports whether `document.referrer` contributed at least one
   * origin. Useful for surfacing a console warning when running in
   * production without an explicit origin and the referrer is absent
   * (because of a `Referrer-Policy: no-referrer` header).
   */
  get referrerWasAvailable(): boolean {
    return this.#referrerWasAvailable;
  }

  /**
   * Indicates whether the detector is operating in a "production-without-
   * explicit-origin" configuration. When `true`, the host should log a
   * loud warning — silent connection failure is the worst outcome.
   */
  get isProductionUnconfigured(): boolean {
    if (!isInIframe()) return false;
    if (this.#explicitOrigins.size > 0) return false;
    if (this.#allowLocalhost) return false;
    if (this.#referrerOrigin !== undefined) return false;
    return true;
  }
}

/**
 * Common ports the inline runtime tries when broadcasting `ready` to
 * a localhost Payload admin. The detection itself uses a pattern, but
 * the handshake needs concrete targets.
 */
const LOCALHOST_HANDSHAKE_PORTS: readonly number[] = [
  3000, 3001, 3333, 4000, 4321, 5000, 5173, 5174, 8000, 8080, 8888, 9000,
];

/**
 * Validate and canonicalise an origin string. Returns `undefined` for
 * inputs that are not absolute `http(s)://host[:port]` origins.
 */
export function normaliseOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!VALID_ORIGIN_PATTERN.test(url.origin)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Pure-functional check used in inline scripts where instantiating a
 * full `OriginDetector` is overkill. The exported helper is also handy
 * for tests and for consumers that want to mimic the matcher policy
 * without holding state.
 */
export function isLocalhostOrigin(origin: string): boolean {
  return LOCALHOST_PATTERN.test(origin);
}
