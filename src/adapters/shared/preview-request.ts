/**
 * Server-side preview-intent detection. Every signal here is client-controlled:
 * a positive result is a delivery hint, never proof of identity or permission.
 * Verify with `authorizePreviewRequest()` before anything privileged.
 */

/** `query`: `?preview=true`; `fetch-dest`: `Sec-Fetch-Dest: iframe`; `referer`: an admin-origin Referer. */
export type PreviewSignal = 'query' | 'fetch-dest' | 'referer';

export interface PreviewRequestOptions {
  /** Which signals count. Default: all three. `['query']` is the adapters' 2.0 default. */
  readonly signals?: readonly PreviewSignal[];
  /** Query parameters (value `true` or `1`) that signal intent. Default `['preview', 'draft', 'livePreview']`. */
  readonly queryParams?: readonly string[];
  /** Admin origins whose Referer signals intent, e.g. `['https://cms.example.com']` — the adapters' option of the same name. */
  readonly allowedOrigins?: readonly string[];
  /** @deprecated Use `allowedOrigins`; removed in 3.0. Ignored when `allowedOrigins` is given. */
  readonly adminOrigins?: readonly string[];
}

const DEFAULT_QUERY_PARAMS = ['preview', 'draft', 'livePreview'] as const;

/** The request surface the predicate reads; `Request` satisfies it, Nitro/H3 events need a shim. */
export interface PreviewRequestLike {
  readonly url: string;
  readonly headers: { get(name: string): string | null };
}

/** Whether `request` carries live-preview intent. Intent, not authorization. */
export function hasPreviewIntent(
  request: PreviewRequestLike,
  options: PreviewRequestOptions = {},
): boolean {
  const signals = new Set<PreviewSignal>(options.signals ?? ['query', 'fetch-dest', 'referer']);
  const queryParams = options.queryParams ?? DEFAULT_QUERY_PARAMS;

  if (signals.has('query')) {
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
  }

  if (signals.has('fetch-dest') && request.headers.get('sec-fetch-dest') === 'iframe') {
    return true;
  }

  // The 1.x spelling is honoured until 3.0; the canonical name wins when both are given.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the alias is read exactly here
  const configured = options.allowedOrigins ?? options.adminOrigins ?? [];
  const adminOrigins = signals.has('referer') ? configured : [];
  if (adminOrigins.length > 0) {
    const referer = request.headers.get('referer');
    if (referer !== null) {
      try {
        const refererOrigin = new URL(referer).origin;
        for (const adminOrigin of adminOrigins) {
          try {
            if (new URL(adminOrigin).origin === refererOrigin) return true;
          } catch {
            // A malformed configured origin matches nothing.
          }
        }
      } catch {
        // A malformed referer is not a signal.
      }
    }
  }

  return false;
}
