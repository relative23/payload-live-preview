/**
 * Server-side preview-intent detection.
 *
 * The live-preview runtime only ever activates inside the Payload
 * admin's iframe, but the *server* still has to decide whether a
 * request expresses preview intent before doing optional preview
 * work. Adapters use this predicate as a delivery optimisation, and
 * consumers with hand-rolled middleware can import it directly.
 *
 * IMPORTANT: every signal inspected here is controlled or triggerable
 * by the client. A positive result is never proof of identity,
 * authentication, or permission to read drafts. Before forwarding
 * credentials, fetching draft data, bypassing caches, changing CSP,
 * or injecting the runtime, verify the request with an application-
 * owned server session or a short-lived signed authorization. Use the
 * same verified decision for all of those effects.
 *
 * Preview intent is present when any of these hold:
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

/** The individual signals the predicate can consider. */
import { warnDeprecatedOnce } from './deprecation';

export type PreviewSignal = 'query' | 'fetch-dest' | 'referer';

export interface PreviewRequestOptions {
  /**
   * Which signals count as preview intent. Default: all three.
   * Restricting this to `['query']` reduces accidental activation, but
   * an explicit `?preview=true` is still client-controlled and must not
   * authorize response changes or privileged data access by itself.
   */
  readonly signals?: readonly PreviewSignal[];
  /**
   * Query parameters (with values `true` or `1`) that signal preview
   * intent. Default: `['preview', 'draft', 'livePreview']`.
   */
  readonly queryParams?: readonly string[];
  /**
   * Treat `Sec-Fetch-Dest: iframe` as a preview-intent signal. Default `true`.
   * Legacy alias for excluding `'fetch-dest'` from `signals`.
   */
  readonly checkFetchDest?: boolean;
  /**
   * Admin origins whose `Referer` signals preview intent, e.g.
   * `['https://cms.example.com']`. Referer matching is not HTTP-request
   * authentication.
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
 * Detect whether `request` carries live-preview intent. See the module
 * docblock for the exact signals and the required authorization
 * boundary. This compatibility name does not imply authentication.
 */
export function hasPreviewIntent(
  request: PreviewRequestLike,
  options: PreviewRequestOptions = {},
): boolean {
  const signals = new Set<PreviewSignal>(options.signals ?? ['query', 'fetch-dest', 'referer']);
  const queryParams = options.queryParams ?? DEFAULT_QUERY_PARAMS;
  const checkFetchDest = (options.checkFetchDest ?? true) && signals.has('fetch-dest');

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

  if (checkFetchDest && request.headers.get('sec-fetch-dest') === 'iframe') {
    return true;
  }

  const adminOrigins = signals.has('referer') ? (options.adminOrigins ?? []) : [];
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

/**
 * @deprecated since 1.1.0 — use {@link hasPreviewIntent}, the same function
 * under the name that says what it is: intent detection, not authorization.
 * Removed in 2.0; ADR 0007 ledger entry 1. Warns once per process outside
 * production.
 */
export function isPreviewRequest(
  request: PreviewRequestLike,
  options: PreviewRequestOptions = {},
): boolean {
  warnDeprecatedOnce(
    'isPreviewRequest',
    'isPreviewRequest() is deprecated; use hasPreviewIntent() — same signature, honest name. ' +
      'It detects client-controlled intent and is not authorization ' +
      '(docs/architecture/0007-v2-defaults-and-renames-ledger.md, entry 1).',
  );
  return hasPreviewIntent(request, options);
}
