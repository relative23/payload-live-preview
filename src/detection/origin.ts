/**
 * Which admin origins the runtime trusts: explicit ones always, the
 * `document.referrer` origin only when none is configured, any localhost port
 * in development. See docs/security.md §1.
 */

import { isDevMode, isInIframe } from './environment';

const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i;
const VALID_ORIGIN_PATTERN = /^https?:\/\/[^/?#\s]+$/i;

/** Ports the handshake broadcasts to when the localhost pattern is on; matching itself is unrestricted. */
const LOCALHOST_HANDSHAKE_PORTS: readonly number[] = [
  3000, 3001, 3333, 4000, 4321, 5000, 5173, 5174, 8000, 8080, 8888, 9000,
];

export interface OriginDetectorOptions {
  /** Explicit origins to trust. Always allowed. */
  readonly additionalOrigins?: readonly string[];
  /** Set to `false` to ignore `document.referrer`. */
  readonly enableReferrerDetection?: boolean;
  /** Set to `false` to ignore the localhost pattern even in development. */
  readonly enableLocalhostMatching?: boolean;
  /** Override dev-mode detection. */
  readonly forceDevMode?: boolean;
  /** Override `document.referrer` for tests. */
  readonly referrer?: string;
}

const enum OriginSlot {
  ExplicitOrigins,
  ReferrerOrigin,
  AllowLocalhost,
  ReferrerWasAvailable,
  LockedOrigin,
}

type OriginState = [
  explicitOrigins: ReadonlySet<string>,
  referrerOrigin: string | undefined,
  allowLocalhost: boolean,
  referrerWasAvailable: boolean,
  lockedOrigin: string | undefined,
];

/** The trusted-origin policy: the union of the candidate sources, narrowed to one by `lockOrigin()`. */
export class OriginDetector {
  readonly #state: OriginState;

  constructor(options: OriginDetectorOptions = {}) {
    const explicit = new Set<string>();
    for (const origin of options.additionalOrigins ?? []) {
      const normalised = normaliseOrigin(origin);
      if (normalised !== undefined) explicit.add(normalised);
    }
    let referrerOrigin: string | undefined;
    if (options.enableReferrerDetection ?? true) {
      const referrer =
        options.referrer ?? (typeof document !== 'undefined' ? document.referrer : '');
      if (referrer.length > 0) {
        try {
          const origin = new URL(referrer).origin;
          if (origin && origin !== 'null') referrerOrigin = origin;
        } catch {
          // opaque referrer
        }
      }
    }
    const allowLocalhost =
      (options.enableLocalhostMatching ?? true) && (options.forceDevMode ?? isDevMode());
    this.#state = [
      explicit,
      referrerOrigin,
      allowLocalhost,
      referrerOrigin !== undefined,
      undefined,
    ];
  }

  /** Whether `origin` is trusted: the locked origin alone once locked, otherwise the policy above. */
  matches(origin: string): boolean {
    if (origin.length === 0 || origin === 'null') return false;
    if (this.#state[OriginSlot.LockedOrigin] !== undefined) {
      return origin === this.#state[OriginSlot.LockedOrigin];
    }
    if (this.#state[OriginSlot.ExplicitOrigins].has(origin)) return true;
    // The referrer is a fallback, not a union member: any embedder lands there.
    if (
      this.#state[OriginSlot.ExplicitOrigins].size === 0 &&
      this.#state[OriginSlot.ReferrerOrigin] !== undefined &&
      origin === this.#state[OriginSlot.ReferrerOrigin]
    ) {
      return true;
    }
    if (this.#state[OriginSlot.AllowLocalhost] && LOCALHOST_PATTERN.test(origin)) return true;
    return false;
  }

  /** Narrow trust to `origin`; refused (`false`) when it is not currently trusted. */
  lockOrigin(origin: string): boolean {
    if (!this.matches(origin)) return false;
    this.#state[OriginSlot.LockedOrigin] = origin;
    return true;
  }

  /** Release the lock (heartbeat timeout) so another allow-listed origin may reconnect. Returns the previous lock. */
  unlockOrigin(): string | undefined {
    const previous = this.#state[OriginSlot.LockedOrigin];
    this.#state[OriginSlot.LockedOrigin] = undefined;
    return previous;
  }

  get lockedOrigin(): string | undefined {
    return this.#state[OriginSlot.LockedOrigin];
  }

  /** Every origin the `ready` handshake is broadcast to; the localhost pattern expands to the common dev ports. */
  enumerate(): string[] {
    if (this.#state[OriginSlot.LockedOrigin] !== undefined) {
      return [this.#state[OriginSlot.LockedOrigin]];
    }
    const result = new Set<string>(this.#state[OriginSlot.ExplicitOrigins]);
    if (
      this.#state[OriginSlot.ExplicitOrigins].size === 0 &&
      this.#state[OriginSlot.ReferrerOrigin] !== undefined
    ) {
      result.add(this.#state[OriginSlot.ReferrerOrigin]);
    }
    if (this.#state[OriginSlot.AllowLocalhost]) {
      for (const port of LOCALHOST_HANDSHAKE_PORTS) {
        result.add(`http://localhost:${String(port)}`);
        result.add(`http://127.0.0.1:${String(port)}`);
      }
    }
    return [...result];
  }

  /** Whether `document.referrer` contributed an origin (absent under `Referrer-Policy: no-referrer`). */
  get referrerWasAvailable(): boolean {
    return this.#state[OriginSlot.ReferrerWasAvailable];
  }

  /** Framed, outside development, with no trusted origin at all: the host should warn (LP0101). */
  get isProductionUnconfigured(): boolean {
    if (!isInIframe()) return false;
    if (this.#state[OriginSlot.ExplicitOrigins].size > 0) return false;
    if (this.#state[OriginSlot.AllowLocalhost]) return false;
    if (this.#state[OriginSlot.ReferrerOrigin] !== undefined) return false;
    return true;
  }

  /** The referrer is the only trust source, so any framing site may drive the preview (LP0102). */
  get isReferrerOnlyTrust(): boolean {
    if (this.#state[OriginSlot.ExplicitOrigins].size > 0) return false;
    if (this.#state[OriginSlot.AllowLocalhost]) return false;
    return this.#state[OriginSlot.ReferrerOrigin] !== undefined;
  }
}

/** The canonical `http(s)://host[:port]` form of `value`, or `undefined` when it is not one. */
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
