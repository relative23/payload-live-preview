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

const noop = (): void => undefined;

export class DataMerger {
  readonly #serverURL: string;
  readonly #apiRoute: string;
  readonly #depth: number;
  readonly #fetchFn: typeof fetch | undefined;
  readonly #log: (...args: unknown[]) => void;
  #inflight: AbortController | null = null;

  constructor(options: DataMergerOptions) {
    // Normalise: no trailing slash on the origin, leading slash on the route.
    this.#serverURL = options.serverURL.replace(/\/+$/, '');
    const route = options.apiRoute ?? '/api';
    this.#apiRoute = route.startsWith('/') ? route : `/${route}`;
    this.#depth = options.depth ?? 1;
    this.#fetchFn = options.fetchFn;
    this.#log = options.log ?? noop;
  }

  /**
   * Whether this message can be merged at all: collections need an
   * `id` in the form values (the admin always includes one), globals
   * only need their slug.
   */
  canMerge(request: MergeRequest): boolean {
    if (request.globalSlug !== undefined && request.globalSlug !== '') return true;
    if (request.collectionSlug === undefined || request.collectionSlug === '') return false;
    const id = request.data['id'];
    return typeof id === 'string' || typeof id === 'number';
  }

  /**
   * Merge raw form values into the stored document via the Payload
   * REST API. See {@link MergeResult} for the outcome semantics.
   */
  async merge(request: MergeRequest): Promise<MergeResult> {
    if (!this.canMerge(request)) return { status: 'unavailable' };
    const fetchFn = this.#fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
    if (fetchFn === undefined) return { status: 'unavailable' };

    this.#inflight?.abort();
    const controller = new AbortController();
    this.#inflight = controller;

    const endpoint =
      request.globalSlug !== undefined && request.globalSlug !== ''
        ? `globals/${request.globalSlug}`
        : `${request.collectionSlug}/${String(request.data['id'])}`;
    const url = `${this.#serverURL}${this.#apiRoute}/${encodeURI(endpoint)}`;

    try {
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
        body: JSON.stringify({
          data: request.data,
          depth: this.#depth,
          // The admin already flattens locales before posting.
          flattenLocales: false,
          ...(request.locale !== undefined ? { locale: request.locale } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.#log('merge fetch failed', response.status, url);
        return { status: 'unavailable' };
      }
      const merged: unknown = await response.json();
      if (merged === null || typeof merged !== 'object' || Array.isArray(merged)) {
        this.#log('merge fetch returned non-object', url);
        return { status: 'unavailable' };
      }
      return { status: 'merged', doc: merged as Record<string, unknown> };
    } catch (error) {
      if (controller.signal.aborted) return { status: 'superseded' };
      this.#log('merge fetch error', error);
      return { status: 'unavailable' };
    } finally {
      if (this.#inflight === controller) this.#inflight = null;
    }
  }

  /** Abort any in-flight merge request. */
  destroy(): void {
    this.#inflight?.abort();
    this.#inflight = null;
  }
}
