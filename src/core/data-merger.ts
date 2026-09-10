/**
 * Server-side merge for Payload 3.x, whose admin posts raw form values with
 * relationships as bare ids. Like the official client, the update is re-fetched
 * through the REST API with `X-Payload-HTTP-Method-Override: GET`, which
 * merges the form values into the stored document and returns it populated.
 * Only the newest request matters: a newer merge aborts the one in flight.
 */

import { isolateDiagnostic, noopDiagnostic } from './diagnostics';

export interface DataMergerOptions {
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** REST route prefix. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth requested from the server. Defaults to `1`. */
  readonly depth?: number;
  readonly fetchFn?: typeof fetch;
  readonly log?: (...args: unknown[]) => void;
}

export interface MergeRequest {
  readonly collectionSlug?: string | undefined;
  readonly globalSlug?: string | undefined;
  readonly data: Record<string, unknown>;
  readonly locale?: string | undefined;
}

/** `superseded`: a newer merge replaced this one. `unavailable`: fall back to the raw values. */
export type MergeResult =
  | { readonly status: 'merged'; readonly doc: Record<string, unknown> }
  | { readonly status: 'superseded' }
  | { readonly status: 'unavailable' };

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    // An iterated character always has a code point; 0 keeps the type and fails closed.
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/** One path segment: non-empty, bounded, not a dot segment, without separators or control characters. */
function isPathSegment(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !hasControlCharacter(value)
  );
}

/** A slug is one of Payload's own names; `?` and `#` never belong in one. */
function isSafeSlug(value: string): boolean {
  return isPathSegment(value, 128) && !value.includes('?') && !value.includes('#');
}

/** An id comes from the form values; a string one is encoded, so `?` and `#` may appear. */
function isSafeId(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && isPathSegment(value, 512);
}

/**
 * Trailing slashes off a base URL, without a regular expression: `/\/+$/`
 * backtracks over a long run of slashes and takes quadratic time on input the
 * page supplies (CodeQL js/polynomial-redos).
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (value.endsWith('/', end)) end -= 1;
  return value.slice(0, end);
}

export class DataMerger {
  private readonly serverURL: string;
  private readonly apiRoute: string;
  private readonly depth: number;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly log: (...args: unknown[]) => void;
  private inflight: AbortController | null = null;
  private attempt = 0;
  private destroyDepth = 0;

  constructor(options: DataMergerOptions) {
    this.serverURL = withoutTrailingSlashes(options.serverURL);
    const route = options.apiRoute ?? '/api';
    this.apiRoute = route.startsWith('/') ? route : `/${route}`;
    this.depth = options.depth ?? 1;
    this.fetchFn = options.fetchFn;
    this.log = isolateDiagnostic(options.log ?? noopDiagnostic);
  }

  /** Collections need an `id` in the form values; globals only their slug. */
  canMerge(request: MergeRequest): boolean {
    return this.endpointOf(request) !== null;
  }

  /**
   * The path under `apiRoute`, or `null` when no safe one exists. A request
   * accessor that throws counts as none, and so does a lone surrogate, which
   * `encodeURIComponent` refuses with a `URIError`.
   */
  private endpointOf(request: MergeRequest): string | null {
    try {
      // An empty global slug means "collection document" on the wire.
      const globalSlug = request.globalSlug;
      if (globalSlug) {
        return isSafeSlug(globalSlug) ? `globals/${encodeURIComponent(globalSlug)}` : null;
      }
      const collectionSlug = request.collectionSlug ?? '';
      const id: unknown = request.data['id'];
      if (!isSafeSlug(collectionSlug) || !isSafeId(id)) return null;
      return `${encodeURIComponent(collectionSlug)}/${encodeURIComponent(String(id))}`;
    } catch {
      return null;
    }
  }

  async merge(request: MergeRequest): Promise<MergeResult> {
    if (this.destroyDepth > 0) return { status: 'superseded' };
    // Claim the attempt before aborting: abort listeners and fetch shims are
    // reentrant, and a newer merge they start must win. Nothing but this class
    // aborts the signal, and only after the counter moved, so the counter
    // alone decides who was superseded.
    const attempt = (this.attempt += 1);
    const previous = this.inflight;
    this.inflight = null;
    let controller: AbortController | null = null;
    const superseded = (): boolean => this.attempt !== attempt;
    try {
      previous?.abort();
      if (superseded()) return { status: 'superseded' };
      // The endpoint reads the request's own values, which may be consumer
      // getters that start a newer merge before throwing.
      const endpoint = this.endpointOf(request);
      if (endpoint === null) {
        return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
      }
      const fetchFn = this.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
      if (fetchFn === undefined) return { status: 'unavailable' };
      controller = new AbortController();
      this.inflight = controller;
      const url = `${this.serverURL}${this.apiRoute}/${endpoint}`;
      const response = await fetchFn(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Payload-HTTP-Method-Override': 'GET',
        },
        // The admin already flattens locales before posting; an absent locale
        // is left out of the JSON.
        body: JSON.stringify({
          data: request.data,
          depth: this.depth,
          flattenLocales: false,
          locale: request.locale,
        }),
        signal: controller.signal,
      });
      // A fetch shim may ignore the signal; the attempt is authoritative.
      if (superseded()) return { status: 'superseded' };
      if (!response.ok) {
        this.log('merge HTTP', response.status, url);
        return { status: 'unavailable' };
      }
      const merged: unknown = await response.json();
      if (superseded()) return { status: 'superseded' };
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        this.log('merge invalid', url);
        return { status: 'unavailable' };
      }
      return { status: 'merged', doc: merged as Record<string, unknown> };
    } catch (error) {
      if (superseded()) return { status: 'superseded' };
      this.log('merge exception', error);
      return { status: 'unavailable' };
    } finally {
      // Only the newest attempt's controller is ever in flight: a superseded
      // attempt's is gone already, and its successor's is left alone.
      if (this.inflight === controller) this.inflight = null;
    }
  }

  /** Abort any in-flight merge. The merger stays usable across a stop/start cycle. */
  destroy(): void {
    this.attempt += 1;
    const inflight = this.inflight;
    this.inflight = null;
    this.destroyDepth += 1;
    try {
      inflight?.abort();
    } finally {
      this.destroyDepth -= 1;
    }
  }
}
