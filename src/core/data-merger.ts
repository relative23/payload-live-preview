/**
 * Server-side data merging for Payload 3.x.
 *
 * The Payload 3.x admin posts **raw form values** on every edit:
 * relationship and upload fields arrive as bare IDs, and nothing is
 * depth-populated. The official `@payloadcms/live-preview` client
 * solves this by re-fetching the document through the Payload REST
 * API with an `X-Payload-HTTP-Method-Override: GET` request — the
 * server merges the form values into the stored document and returns
 * the populated result.
 *
 * `DataMerger` replicates that exact request shape. It is optional:
 * when no `serverURL` is configured the runtime renders the raw form
 * values directly, which is fine for scalar fields but leaves
 * relationship/upload fields as IDs.
 *
 * Coalescing: only the most recent update matters, so an in-flight
 * request is aborted whenever a newer one starts. Failures degrade
 * gracefully — the caller falls back to the raw values.
 *
 * @module @core/data-merger
 */

import { isolateDiagnostic, noopDiagnostic } from './diagnostics';

export interface DataMergerOptions {
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** REST API route prefix. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth requested from the server. Defaults to `1`. */
  readonly depth?: number;
  /** Injectable fetch implementation (tests, SSR shims). */
  readonly fetchFn?: typeof fetch;
  /** Diagnostic logger. */
  readonly log?: (...args: unknown[]) => void;
}

export interface MergeRequest {
  readonly collectionSlug?: string | undefined;
  readonly globalSlug?: string | undefined;
  readonly data: Record<string, unknown>;
  readonly locale?: string | undefined;
}

/**
 * Outcome of a merge attempt.
 *
 *   - `merged` — the server returned a populated document.
 *   - `superseded` — a newer update aborted this one; drop it silently.
 *   - `unavailable` — not mergeable / fetch failed; fall back to the
 *     raw form values.
 */
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
    // Lone UTF-16 surrogates cannot be encoded into a valid URL segment.
    return false;
  }
}

const enum MergerSlot {
  ServerURL,
  ApiRoute,
  Depth,
  FetchFn,
  Log,
  Inflight,
  Attempt,
  DestroyDepth,
}

type DataMergerState = [
  serverURL: string,
  apiRoute: string,
  depth: number,
  fetchFn: typeof fetch | undefined,
  log: (...args: unknown[]) => void,
  inflight: AbortController | null,
  attempt: number,
  destroyDepth: number,
];

export class DataMerger {
  private readonly s: DataMergerState;

  constructor(options: DataMergerOptions) {
    // Normalise: no trailing slash on the origin, leading slash on the route.
    const serverURL = options.serverURL.replace(/\/+$/, '');
    const route = options.apiRoute ?? '/api';
    this.s = [
      serverURL,
      route.startsWith('/') ? route : `/${route}`,
      options.depth ?? 1,
      options.fetchFn,
      options.log === undefined ? noopDiagnostic : isolateDiagnostic(options.log),
      null,
      0,
      0,
    ];
  }

  /**
   * Whether this message can be merged at all: collections need an
   * `id` in the form values (the admin always includes one), globals
   * only need their slug.
   */
  canMerge(request: MergeRequest): boolean {
    try {
      // Payload 1.x integrations historically use an empty global slug to mean
      // “collection document”; preserve that wire representation as absence.
      if (request.globalSlug) return isSafeSlug(request.globalSlug);
      if (!isSafeSlug(request.collectionSlug)) return false;
      const id = request.data['id'];
      return isSafeId(id);
    } catch {
      // This is a public trust-boundary predicate. Hostile accessors fail closed.
      return false;
    }
  }

  /**
   * Merge raw form values into the stored document via the Payload
   * REST API. See {@link MergeResult} for the outcome semantics.
   */
  async merge(request: MergeRequest): Promise<MergeResult> {
    if (this.s[MergerSlot.DestroyDepth] > 0) return { status: 'superseded' };
    // Every merge attempt supersedes the previous one, including attempts
    // that fail validation or cannot fetch. Claim attempt ownership before
    // aborting: AbortSignal listeners and request/fetch shims are reentrant and
    // a newer call they start must not be overwritten by this older stack.
    const attempt = this.s[MergerSlot.Attempt] + 1;
    this.s[MergerSlot.Attempt] = attempt;
    const previous = this.s[MergerSlot.Inflight];
    this.s[MergerSlot.Inflight] = null;
    let controller: AbortController | null = null;

    try {
      previous?.abort();
      if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };

      if (!this.canMerge(request)) {
        return isLatestAttempt(this.s, attempt)
          ? { status: 'unavailable' }
          : { status: 'superseded' };
      }
      if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
      const fetchFn =
        this.s[MergerSlot.FetchFn] ?? (typeof fetch === 'function' ? fetch : undefined);
      if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
      if (fetchFn === undefined) return { status: 'unavailable' };

      controller = new AbortController();
      if (!isLatestAttempt(this.s, attempt)) {
        controller.abort();
        return { status: 'superseded' };
      }
      this.s[MergerSlot.Inflight] = controller;

      const endpoint = request.globalSlug
        ? `globals/${encodeURIComponent(request.globalSlug)}`
        : `${encodeURIComponent(request.collectionSlug ?? '')}/${encodeURIComponent(
            String(request.data['id']),
          )}`;
      const url = `${this.s[MergerSlot.ServerURL]}${this.s[MergerSlot.ApiRoute]}/${endpoint}`;
      const body = JSON.stringify({
        data: request.data,
        depth: this.s[MergerSlot.Depth],
        // The admin already flattens locales before posting.
        flattenLocales: false,
        ...(request.locale !== undefined ? { locale: request.locale } : {}),
      });
      if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
      const response = await fetchFn(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          // Payload's REST layer treats this POST as a GET with a body:
          // the body's `data` is merged into the stored document and the
          // populated result is returned.
          'X-Payload-HTTP-Method-Override': 'GET',
        },
        body,
        signal: controller.signal,
      });
      // Fetch implementations are allowed to ignore AbortSignal. Treat the
      // attempt identity as authoritative before observing any response state
      // so a superseded request can never be reported as merged/unavailable.
      if (!isLatestAttempt(this.s, attempt) || isAborted(controller.signal)) {
        return { status: 'superseded' };
      }
      const ok = response.ok;
      if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
      if (!ok) {
        const status = response.status;
        if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
        this.s[MergerSlot.Log]('merge HTTP', status, url);
        if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
        return { status: 'unavailable' };
      }
      const merged: unknown = await response.json();
      // Parsing can be asynchronous too (or supplied by a test/SSR shim) and
      // may likewise ignore cancellation.
      if (!isLatestAttempt(this.s, attempt) || isAborted(controller.signal)) {
        return { status: 'superseded' };
      }
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        this.s[MergerSlot.Log]('merge invalid', url);
        if (!isLatestAttempt(this.s, attempt)) return { status: 'superseded' };
        return { status: 'unavailable' };
      }
      return { status: 'merged', doc: merged as Record<string, unknown> };
    } catch (error) {
      if (
        !isLatestAttempt(this.s, attempt) ||
        (controller !== null && isAborted(controller.signal))
      ) {
        return { status: 'superseded' };
      }
      this.s[MergerSlot.Log]('merge exception', error);
      return isLatestAttempt(this.s, attempt)
        ? { status: 'unavailable' }
        : { status: 'superseded' };
    } finally {
      if (
        controller !== null &&
        isLatestAttempt(this.s, attempt) &&
        this.s[MergerSlot.Inflight] === controller
      ) {
        this.s[MergerSlot.Inflight] = null;
      }
    }
  }

  /** Abort any in-flight merge request. */
  destroy(): void {
    this.s[MergerSlot.Attempt] += 1;
    const inflight = this.s[MergerSlot.Inflight];
    this.s[MergerSlot.Inflight] = null;
    this.s[MergerSlot.DestroyDepth] += 1;
    try {
      inflight?.abort();
    } finally {
      // DataMerger is reusable by the runtime after a stop/start cycle; only
      // calls entered reentrantly during the abort transaction are rejected.
      this.s[MergerSlot.DestroyDepth] -= 1;
    }
  }
}

function isLatestAttempt(state: DataMergerState, attempt: number): boolean {
  return state[MergerSlot.Attempt] === attempt;
}

function isAborted(signal: AbortSignal): boolean {
  // Keep cancellation checks opaque to static control-flow narrowing: an
  // injected fetch/body parser may await while another task aborts the signal.
  return signal.aborted;
}
