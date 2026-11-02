/**
 * Payload 3 raw form values use its REST merge with the method-override header.
 * Payload 2 sends a schema instead of a target, so it uses local values and
 * collection GETs to populate references. A newer merge aborts the one in flight,
 * and captured attempt identity drops obsolete results even when a shim ignores abort.
 * An optional deadline aborts a merge that has not answered in time.
 */

import { isolateDiagnostic, noopDiagnostic } from './diagnostics';
import type { PayloadFieldSchema } from '@/types/payload-protocol';
import { fillLegacyPopulation, planLegacyPopulation, populationBody } from './legacy-population';

export interface DataMergerOptions {
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** REST route prefix. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth requested from the server. Defaults to `1`. */
  readonly depth?: number;
  readonly fetchFn?: typeof fetch;
  readonly log?: (...args: unknown[]) => void;
  /**
   * Milliseconds a merge may wait for the server before it is aborted and reported
   * `unavailable`. Off unless a positive finite number.
   */
  readonly timeoutMs?: number;
}

export interface MergeRequest {
  readonly schema?: readonly PayloadFieldSchema[] | undefined;
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

interface MergeTarget {
  readonly path: string;
  readonly field: 'id' | 'globalType';
  readonly value: string;
}

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
/** What the deadline rejects with: no fetch, body or shim rejects with this object. */
const TIMED_OUT = new Error();

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
  private readonly timeoutMs: number | undefined;
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
    const timeoutMs = options.timeoutMs ?? 0;
    this.timeoutMs = timeoutMs > 0 && timeoutMs < Number.POSITIVE_INFINITY ? timeoutMs : undefined;
  }

  /** A v2 schema plans local values and GETs; a v3 target needs its document identity. */
  canMerge(request: MergeRequest): boolean {
    try {
      const schema = request.schema;
      if (schema !== undefined) {
        planLegacyPopulation(
          request.data,
          schema,
          this.serverURL,
          this.apiRoute,
          this.depth,
          request.locale,
        );
        return true;
      }
      return this.endpointOf(request) !== null;
    } catch {
      return false;
    }
  }

  /**
   * The path and its response identity, or `null` when no safe one exists. A request
   * accessor that throws counts as none, and so does a lone surrogate, which
   * `encodeURIComponent` refuses with a `URIError`.
   */
  private endpointOf(request: MergeRequest): MergeTarget | null {
    try {
      // An empty global slug means "collection document" on the wire.
      const globalSlug = request.globalSlug;
      if (globalSlug) {
        return isSafeSlug(globalSlug)
          ? {
              path: `globals/${encodeURIComponent(globalSlug)}`,
              field: 'globalType',
              value: globalSlug,
            }
          : null;
      }
      const collectionSlug = request.collectionSlug ?? '';
      const id: unknown = request.data['id'];
      if (!isSafeSlug(collectionSlug) || !isSafeId(id)) return null;
      return {
        path: `${encodeURIComponent(collectionSlug)}/${encodeURIComponent(String(id))}`,
        field: 'id',
        value: String(id),
      };
    } catch {
      return null;
    }
  }

  /**
   * Fulfills merged, superseded or unavailable. Supported request, fetch and
   * response failures are outcomes; isolated diagnostics cannot reject the merge.
   */
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
    let legacy = false;
    const superseded = (): boolean => this.attempt !== attempt;
    // Every wait on the server races one deadline, armed with the attempt's controller at its
    // first request; a shim that ignores the abort cannot hold the merge past it, and what it
    // answers later is never read.
    const timeoutMs = this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: Promise<never> | undefined;
    let timedOut = false;
    const expired = (): boolean => timedOut;
    const within = <T>(work: Promise<T>, owned: AbortController): Promise<T> => {
      if (timeoutMs === undefined) return work;
      if (deadline === undefined) {
        deadline = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            // First: a fetch that rejects as it is aborted must still read as the deadline.
            timedOut = true;
            owned.abort();
            reject(TIMED_OUT);
          }, timeoutMs);
        });
        deadline.catch(() => undefined);
      }
      return Promise.race([work, deadline]);
    };
    try {
      previous?.abort();
      if (superseded()) return { status: 'superseded' };
      const schema = request.schema;
      legacy = schema !== undefined;
      if (schema !== undefined) {
        const plan = planLegacyPopulation(
          request.data,
          schema,
          this.serverURL,
          this.apiRoute,
          this.depth,
          request.locale,
        );
        if (superseded()) return { status: 'superseded' };
        if (plan.requests.length === 0) return { status: 'merged', doc: plan.doc };
        const fetchFn = this.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
        if (superseded()) return { status: 'superseded' };
        if (fetchFn === undefined) return { status: 'unavailable' };
        controller = new AbortController();
        this.inflight = controller;
        for (const population of plan.requests) {
          const response = await within(
            fetchFn(population.url, {
              method: 'GET',
              credentials: 'include',
              redirect: 'error',
              signal: controller.signal,
            }),
            controller,
          );
          if (superseded()) return { status: 'superseded' };
          const ok = response.ok;
          if (superseded()) return { status: 'superseded' };
          if (!ok) {
            const status = response.status;
            if (superseded()) return { status: 'superseded' };
            controller.abort();
            if (superseded()) return { status: 'superseded' };
            this.log('merge HTTP', status);
            return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
          }
          const body = await within(
            populationBody(response, controller.signal, () => !superseded()),
            controller,
          );
          if (superseded()) return { status: 'superseded' };
          fillLegacyPopulation(population, body);
          if (superseded()) return { status: 'superseded' };
        }
        return { status: 'merged', doc: plan.doc };
      }
      // The endpoint reads the request's own values, which may be consumer
      // getters that start a newer merge before throwing.
      const endpoint = this.endpointOf(request);
      if (superseded()) return { status: 'superseded' };
      if (endpoint === null) return { status: 'unavailable' };
      const fetchFn = this.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
      if (superseded()) return { status: 'superseded' };
      if (fetchFn === undefined) return { status: 'unavailable' };
      // Serialize before publishing the controller: accessors may accept newer work.
      const body = JSON.stringify({
        data: request.data,
        depth: this.depth,
        flattenLocales: false,
        locale: request.locale,
      });
      if (superseded()) return { status: 'superseded' };
      controller = new AbortController();
      this.inflight = controller;
      const url = `${this.serverURL}${this.apiRoute}/${endpoint.path}`;
      const response = await within(
        fetchFn(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Payload-HTTP-Method-Override': 'GET',
          },
          // The admin already flattens locales before posting; an absent locale
          // is left out of the JSON.
          body,
          signal: controller.signal,
        }),
        controller,
      );
      // A fetch shim may ignore the signal; the attempt is authoritative.
      if (superseded()) return { status: 'superseded' };
      const ok = response.ok;
      if (superseded()) return { status: 'superseded' };
      if (!ok) {
        const status = response.status;
        if (superseded()) return { status: 'superseded' };
        this.log('merge HTTP', status, url);
        return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
      }
      const json: () => Promise<unknown> = response.json.bind(response);
      if (superseded()) return { status: 'superseded' };
      const merged: unknown = await within(json(), controller);
      if (superseded()) return { status: 'superseded' };
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        this.log('merge invalid', url);
        return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
      }
      const doc = merged as Record<string, unknown>;
      // Missing IDs remain compatible with projected responses. An explicit
      // identity must match the dispatched target, never mutable request data.
      const identity = doc[endpoint.field];
      const wrongIdentity =
        Object.hasOwn(doc, endpoint.field) &&
        (endpoint.field === 'id'
          ? !isSafeId(identity) || String(identity) !== endpoint.value
          : identity !== endpoint.value);
      if (superseded()) return { status: 'superseded' };
      if (wrongIdentity) {
        this.log('merge invalid', url);
        return superseded() ? { status: 'superseded' } : { status: 'unavailable' };
      }
      return { status: 'merged', doc };
    } catch (error) {
      if (superseded()) return { status: 'superseded' };
      if (expired()) {
        this.log('merge timeout', timeoutMs);
        return { status: 'unavailable' };
      }
      if (legacy) {
        controller?.abort();
        if (superseded()) return { status: 'superseded' };
      }
      this.log(
        'merge exception',
        legacy ? new Error('legacy population could not be resolved') : error,
      );
      if (superseded()) return { status: 'superseded' };
      return { status: 'unavailable' };
    } finally {
      clearTimeout(timer);
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
