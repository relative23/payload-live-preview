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
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

function isSafeSlug(value: string | undefined): value is string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 128 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    hasControlCharacter(value)
  ) {
    return false;
  }
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function isSafeId(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    return false;
  }
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    // A lone surrogate cannot become a URL segment.
    return false;
  }
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
    this.serverURL = options.serverURL.replace(/\/+$/, '');
    const route = options.apiRoute ?? '/api';
    this.apiRoute = route.startsWith('/') ? route : `/${route}`;
    this.depth = options.depth ?? 1;
    this.fetchFn = options.fetchFn;
    this.log = options.log === undefined ? noopDiagnostic : isolateDiagnostic(options.log);
  }

  /** Collections need an `id` in the form values; globals only their slug. */
  canMerge(request: MergeRequest): boolean {
    try {
      // An empty global slug means "collection document" on the wire.
      if (request.globalSlug) return isSafeSlug(request.globalSlug);
      if (!isSafeSlug(request.collectionSlug)) return false;
      return isSafeId(request.data['id']);
    } catch {
      return false;
    }
  }

  async merge(request: MergeRequest): Promise<MergeResult> {
    if (this.destroyDepth > 0) return { status: 'superseded' };
    // Claim the attempt before aborting: abort listeners and fetch shims are
    // reentrant, and a newer merge they start must win.
    const attempt = (this.attempt += 1);
    const previous = this.inflight;
    this.inflight = null;
    let controller: AbortController | null = null;
    const superseded = (): boolean => this.attempt !== attempt;
    try {
      previous?.abort();
      if (superseded()) return { status: 'superseded' };
      // `canMerge` reads the request's own values, which may be consumer getters
      // that start a newer merge before throwing.
      if (!this.canMerge(request)) {
        return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
      }
      const fetchFn = this.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
      if (fetchFn === undefined) return { status: 'unavailable' };
      controller = new AbortController();
      this.inflight = controller;
      const endpoint = request.globalSlug
        ? `globals/${encodeURIComponent(request.globalSlug)}`
        : `${encodeURIComponent(request.collectionSlug ?? '')}/${encodeURIComponent(
            String(request.data['id']),
          )}`;
      const url = `${this.serverURL}${this.apiRoute}/${endpoint}`;
      const response = await fetchFn(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Payload-HTTP-Method-Override': 'GET',
        },
        body: JSON.stringify({
          data: request.data,
          depth: this.depth,
          // The admin already flattens locales before posting.
          flattenLocales: false,
          ...(request.locale !== undefined ? { locale: request.locale } : {}),
        }),
        signal: controller.signal,
      });
      // A fetch shim may ignore the signal; the attempt is authoritative.
      if (superseded() || isAborted(controller.signal)) return { status: 'superseded' };
      if (!response.ok) {
        this.log('merge HTTP', response.status, url);
        return { status: 'unavailable' };
      }
      const merged: unknown = await response.json();
      if (superseded() || isAborted(controller.signal)) return { status: 'superseded' };
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        this.log('merge invalid', url);
        return { status: 'unavailable' };
      }
      return { status: 'merged', doc: merged as Record<string, unknown> };
    } catch (error) {
      if (superseded() || (controller !== null && isAborted(controller.signal))) {
        return { status: 'superseded' };
      }
      this.log('merge exception', error);
      return { status: 'unavailable' };
    } finally {
      if (controller !== null && !superseded() && this.inflight === controller) {
        this.inflight = null;
      }
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

/** Opaque to control-flow narrowing: an injected fetch or parser may await while another task aborts. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
