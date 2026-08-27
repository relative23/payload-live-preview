/**
 * Draft-aware document fetching for the initial preview render.
 *
 * The live-preview runtime patches the DOM *after* the page loads —
 * the initial server render is the consumer's job. With Payload
 * drafts enabled, an **authorized** preview should render the draft
 * version on first load, otherwise editors see stale published
 * content until their first keystroke.
 *
 * These helpers wrap the corresponding REST queries with `draft` and
 * `depth` options and an explicit nudge to keep `depth` in sync with
 * the runtime's `mergeDepth` — a mismatch makes populated
 * relationships degrade to IDs after the first edit.
 *
 * These helpers do not authenticate or authorize requests.
 * `hasPreviewIntent()` detects client-controlled preview intent only.
 * Verify an application-owned server session or short-lived signed
 * authorization first, and use that one decision to gate `draft`, any
 * privileged headers, cache bypass, CSP changes, and runtime injection.
 * Never attach a long-lived service/API key merely because
 * `hasPreviewIntent()` returned `true`.
 *
 * Isomorphic and dependency-free: works in Astro frontmatter,
 * SvelteKit `load`, Next.js server components, or any Node/edge
 * runtime with `fetch`.
 *
 * ```ts
 * // Astro frontmatter. `verifyAppPreviewSession` is application-owned,
 * // server-only code; it validates the request and returns only the
 * // minimal Payload session headers needed for this request.
 * const intent = hasPreviewIntent(Astro.request);
 * const authorization = intent
 *   ? await verifyAppPreviewSession(Astro.request)
 *   : null;
 * const page = await fetchPreviewDocument<Page>({
 *   serverURL: import.meta.env.PAYLOAD_URL,
 *   collection: 'pages',
 *   where: { slug: { equals: Astro.params.slug } },
 *   draft: authorization !== null,
 *   ...(authorization === null ? {} : { headers: authorization.payloadHeaders }),
 * });
 * ```
 *
 * @module @preview-fetch
 */

import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';

import { warnDeprecatedOnce } from '@adapters/shared/deprecation';
export interface PreviewFetchBaseOptions {
  /** Payload server origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** REST API route prefix. Defaults to `/api`. */
  readonly apiRoute?: string;
  /**
   * Population depth. Defaults to `1`. ⚠️ Keep this equal to the
   * runtime's `mergeDepth` — the live-merge re-fetches with that
   * depth, and a mismatch makes nested relationships flip between
   * objects and IDs mid-session.
   */
  readonly depth?: number;
  /**
   * Fetch the draft version. Defaults to `true` for 1.x compatibility.
   * Set this from a verified authorization decision, not directly
   * from `hasPreviewIntent()`, whose result only expresses intent.
   */
  readonly draft?: boolean;
  /**
   * The verdict from `authorizePreviewRequest()`, or `null` for a public
   * request. When given it governs: `draft` follows it (a real context reads
   * the draft, anything else the published document, whatever `draft` says)
   * and the context's `payloadHeaders` are forwarded. Prefer this over
   * setting `draft` and `headers` by hand.
   */
  readonly authorization?: AuthorizedPreviewContext | null;
  /** Locale to fetch. */
  readonly locale?: string;
  /**
   * Extra request headers. Supply only credentials derived from the
   * current request's verified server-side session (or another
   * short-lived, scoped authorization). Do not attach a long-lived
   * service/API key based on a preview-intent signal.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Injectable fetch implementation (tests, custom agents). */
  readonly fetchFn?: typeof fetch;
}

/** Payload `where` clause — kept loose on purpose (server validates). */
export type PreviewWhere = Readonly<Record<string, unknown>>;

export interface FetchPreviewDocumentOptions extends PreviewFetchBaseOptions {
  /** Collection slug. */
  readonly collection: string;
  /** Fetch a single document by id. Mutually exclusive with `where`. */
  readonly id?: string | number;
  /**
   * Fetch the first document matching this Payload `where` clause,
   * e.g. `{ slug: { equals: 'about' } }`.
   */
  readonly where?: PreviewWhere;
}

export interface FetchPreviewGlobalOptions extends PreviewFetchBaseOptions {
  /** Global slug. */
  readonly global: string;
}

/**
 * Fetch a single collection document (draft-first by default for 1.x
 * compatibility; callers must authorize draft access).
 * Returns `null` when nothing matches or the request fails —
 * loaders should fall back to their regular data path or a 404.
 *
 * @deprecated since 1.2.0 — use `definePreview()` from `payload-live-preview/server`:
 * one depth shared with the runtime, an explicit authorization verdict as the
 * draft decision, `AbortSignal`, timeout and a typed failure. This helper keeps
 * its 1.x behaviour (draft by default, `null` on any failure) and is removed
 * in 2.0 (ADR 0007, entry 9).
 */
export async function fetchPreviewDocument<T = Record<string, unknown>>(
  options: FetchPreviewDocumentOptions,
): Promise<T | null> {
  warnDeprecatedOnce(
    'fetchPreviewDocument',
    'fetchPreviewDocument() is deprecated; use definePreview() from payload-live-preview/server ' +
      '(docs/architecture/0007-v2-defaults-and-renames-ledger.md, entry 9).',
  );
  const params = baseParams(options);
  if (options.id !== undefined) {
    const url = `${apiBase(options)}/${encodeURIComponent(options.collection)}/${encodeURIComponent(
      String(options.id),
    )}?${params.toString()}`;
    return requestJson<T>(url, options);
  }

  if (options.where !== undefined) {
    appendWhere(params, options.where, ['where']);
  }
  params.set('limit', '1');
  const url = `${apiBase(options)}/${encodeURIComponent(options.collection)}?${params.toString()}`;
  const page = await requestJson<{ docs?: T[] }>(url, options);
  const first = page?.docs?.[0];
  return first ?? null;
}

/**
 * Fetch a global (draft-first by default for 1.x compatibility;
 * callers must authorize draft access). Returns `null` on failure.
 *
 * @deprecated since 1.2.0 — use `definePreview()` from `payload-live-preview/server`:
 * one depth shared with the runtime, an explicit authorization verdict as the
 * draft decision, `AbortSignal`, timeout and a typed failure. This helper keeps
 * its 1.x behaviour (draft by default, `null` on any failure) and is removed
 * in 2.0 (ADR 0007, entry 9).
 */
export async function fetchPreviewGlobal<T = Record<string, unknown>>(
  options: FetchPreviewGlobalOptions,
): Promise<T | null> {
  warnDeprecatedOnce(
    'fetchPreviewGlobal',
    'fetchPreviewGlobal() is deprecated; use definePreview() from payload-live-preview/server ' +
      '(docs/architecture/0007-v2-defaults-and-renames-ledger.md, entry 9).',
  );
  const params = baseParams(options);
  const url = `${apiBase(options)}/globals/${encodeURIComponent(options.global)}?${params.toString()}`;
  return requestJson<T>(url, options);
}

function apiBase(options: PreviewFetchBaseOptions): string {
  const origin = options.serverURL.replace(/\/+$/, '');
  const route = options.apiRoute ?? '/api';
  return `${origin}${route.startsWith('/') ? route : `/${route}`}`;
}

function baseParams(options: PreviewFetchBaseOptions): URLSearchParams {
  const params = new URLSearchParams();
  params.set('depth', String(options.depth ?? 1));
  if (wantsDraft(options)) params.set('draft', 'true');
  if (options.locale !== undefined) params.set('locale', options.locale);
  return params;
}

/**
 * Serialise a nested `where` object into Payload's qs-style query
 * params: `{ slug: { equals: 'x' } }` → `where[slug][equals]=x`.
 */
function appendWhere(params: URLSearchParams, node: PreviewWhere, path: string[]): void {
  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...path, key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      appendWhere(params, value as PreviewWhere, nextPath);
      continue;
    }
    const name = nextPath.map((seg, i) => (i === 0 ? seg : `[${seg}]`)).join('');
    if (Array.isArray(value)) {
      params.set(name, value.map(String).join(','));
    } else {
      params.set(name, String(value));
    }
  }
}

async function requestJson<T>(url: string, options: PreviewFetchBaseOptions): Promise<T | null> {
  const fetchFn = options.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
  if (fetchFn === undefined) return null;
  try {
    const response = await fetchFn(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {}),
        ...(isAuthorizedPreviewContext(options.authorization)
          ? options.authorization.payloadHeaders
          : {}),
      },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') return null;
    return body as T;
  } catch {
    return null;
  }
}

/** The verdict decides when it is present; the 1.x default (`draft: true`) applies only without one. */
function wantsDraft(options: PreviewFetchBaseOptions): boolean {
  if (options.authorization !== undefined) return isAuthorizedPreviewContext(options.authorization);
  return options.draft ?? true;
}
