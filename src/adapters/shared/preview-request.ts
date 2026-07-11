/**
 * Server-side preview-request detection.
 *
 * The live-preview runtime only ever activates inside the Payload
 * admin's iframe, but the *server* still has to decide whether to
 * inject the (sizeable) inline script into a given HTML response.
 * Injecting it into every page for every visitor buffers every
 * response and ships dead bytes to production traffic — so adapters
 * gate injection on this predicate by default, and consumers with
 * hand-rolled middleware can import it directly.
 *
 * A request counts as a preview when any of these hold:
 *
 *   1. A preview query parameter is present (`?preview=true`,
 *      `?draft=true`, `?livePreview=true` — configurable).
 *   2. `Sec-Fetch-Dest: iframe` — the document is being loaded as an
 *      iframe, which is exactly how the Payload admin embeds it.
 *      (Sent by all evergreen browsers; absence never *excludes* a
 *      request, presence includes it.)
 *   3. The `Referer` points at one of the given admin origins.
 *
 * @module @adapters/shared/preview-request
 */

export interface PreviewRequestOptions {
  /**
   * Query parameters (with values `true` or `1`) that mark a request
   * as a preview. Default: `['preview', 'draft', 'livePreview']`.
   */
  readonly queryParams?: readonly string[];
  /**
   * Treat `Sec-Fetch-Dest: iframe` as a preview signal. Default `true`.
   */
  readonly checkFetchDest?: boolean;
  /**
   * Admin origins whose `Referer` marks a request as a preview,
   * e.g. `['https://cms.example.com']`.
   */
  readonly adminOrigins?: readonly string[];
}

const DEFAULT_QUERY_PARAMS = ['preview', 'draft', 'livePreview'] as const;

/**
 * The minimal request surface the predicate needs. The standard
 * `Request` satisfies it structurally, and server frameworks without
 * fetch-style requests (e.g. Nitro/H3) can supply a tiny shim.
 */
export interface PreviewRequestLike {
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

/**
 * Decide whether `request` is a live-preview request. See the module
 * docblock for the exact signals.
 */
export function isPreviewRequest(
  request: PreviewRequestLike,
  options: PreviewRequestOptions = {},
): boolean {
  const queryParams = options.queryParams ?? DEFAULT_QUERY_PARAMS;
  const checkFetchDest = options.checkFetchDest ?? true;

  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    url = undefined;
  }
  if (url !== undefined) {
    for (const param of queryParams) {
      const value = url.searchParams.get(param);
      if (value === 'true' || value === '1') return true;
    }
  }

  if (checkFetchDest && request.headers.get('sec-fetch-dest') === 'iframe') {
    return true;
  }

  const adminOrigins = options.adminOrigins ?? [];
  if (adminOrigins.length > 0) {
    const referer = request.headers.get('referer');
    if (referer !== null) {
      try {
        const refererOrigin = new URL(referer).origin;
        for (const adminOrigin of adminOrigins) {
          try {
            if (new URL(adminOrigin).origin === refererOrigin) return true;
          } catch {
            // skip malformed configured origin
          }
        }
      } catch {
        // malformed referer — not a preview signal
      }
    }
  }

  return false;
}
