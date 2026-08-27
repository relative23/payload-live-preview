/**
 * `payload-live-preview/server` — the privileged, server-only surface.
 *
 * Everything here runs where a secret or a session may be handled: the
 * initial draft read, token issuance and verification, the binding helpers
 * that decide whether markup discloses the content model. None of it is
 * reachable from a browser bundle; the architecture policy lists `server`
 * among the server-only domains, so a client, runtime or adapter module that
 * imported it would fail the build.
 *
 * `definePreview()` is the one configuration: the Payload origin, the API
 * route and **one depth** shared by the initial fetch and the runtime's
 * merge, so the two can no longer drift apart (`?? 1` in two places was how
 * they did). Reads take the authorization verdict as their explicit input —
 * a draft is fetched only with a context produced by
 * `authorizePreviewRequest()`, never by default — and report failure as a
 * typed result unless asked to throw.
 *
 * The root-entry helpers `fetchPreviewDocument()` / `fetchPreviewGlobal()`
 * keep their 1.x behaviour (draft by default, `null` on any failure) and are
 * deprecated in favour of this module (ADR 0007, entries 9 and 10).
 *
 * @module @server
 */

import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';

export {
  authorizePreviewRequest,
  extractCookie,
  isAuthorizedPreviewContext,
  issuePreviewToken,
  type AuthorizedPreviewContext,
  type AuthorizedPreviewScope,
  type FetchLike,
  type IssuePreviewTokenOptions,
  type PayloadSessionStrategy,
  type PreviewAuthorization,
  type PreviewAuthorizationOutcome,
  type PreviewAuthorizationRequest,
  type PreviewAuthorizationStrategy,
  type PreviewAuthorizationStrategyName,
  type PreviewTokenClaims,
  type PreviewTokenReplayStore,
  type PreviewTokenTransport,
  type PreviewVerifierClaims,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
  type VerifierStrategy,
} from '@security/preview-authorization';
export {
  hasPreviewIntent,
  type PreviewRequestLike,
  type PreviewRequestOptions,
  type PreviewSignal,
} from '@adapters/shared/preview-request';
export { bind, bindByPath, createPreviewBindings } from '@dsl/index';
export type {
  BindOptions,
  FieldBindingAttributes,
  FieldName,
  FieldPath,
  OwnerBindingAttributes,
  PreviewBindings,
  PreviewBindingsCommonOptions,
  PreviewBindingsOptions,
  SuppressedBinding,
  ValueAt,
} from '@dsl/index';

/** A `fetch`-compatible function. Injectable for tests and for runtimes that wrap `fetch`. */
export type PreviewFetchFunction = (
  input: string,
  init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

/** What a read or a failure looked like, for logs and metrics. Never carries a header value. */
export type PreviewFetchDiagnostic =
  | {
      readonly kind: 'response';
      readonly url: string;
      readonly status: number;
      readonly draft: boolean;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'failure';
      readonly url: string;
      readonly reason: PreviewFetchFailureReason;
      readonly status: number | undefined;
      readonly draft: boolean;
      readonly durationMs: number;
    };

/** The one configuration the initial read and the runtime merge share. */
export interface PreviewServerConfig {
  /** Payload origin, e.g. `https://cms.example.com`. */
  readonly serverURL: string;
  /** REST route prefix. Default `/api`. */
  readonly apiRoute?: string;
  /**
   * Population depth for the initial read **and** for `mergeDepth` in the
   * runtime options this config produces. Required: Payload's own default is
   * `0`, this package's runtime default has been `1`, and a page that
   * renders populated relations needs the number written down once, where
   * both readers see it.
   */
  readonly depth: number;
  /** Upper bound for one read, including a slow Payload. Default 5000 ms. */
  readonly timeoutMs?: number;
  readonly fetch?: PreviewFetchFunction;
  /** Observe every read and failure — for logs and metrics, not for control flow. */
  readonly onDiagnostic?: (diagnostic: PreviewFetchDiagnostic) => void;
}

/** Why a read did not produce a document. */
export type PreviewFetchFailureReason =
  'http' | 'network' | 'timeout' | 'aborted' | 'invalid-json' | 'no-fetch';

export type PreviewFetchResult<T> =
  | {
      readonly ok: true;
      /** The document, or `null` when the query matched nothing. */
      readonly data: T | null;
      /** Whether the draft version was requested — `true` exactly when `authorization` was a real context. */
      readonly draft: boolean;
      readonly status: number;
    }
  | {
      readonly ok: false;
      readonly reason: PreviewFetchFailureReason;
      readonly status: number | undefined;
      readonly draft: boolean;
      /** The underlying error for `network`, `invalid-json` and `aborted`. */
      readonly cause: unknown;
    };

/** Thrown in `errorMode: 'throw'` instead of returning the failed result. */
export class PreviewFetchError extends Error {
  readonly reason: PreviewFetchFailureReason;
  readonly status: number | undefined;
  readonly url: string;
  constructor(
    reason: PreviewFetchFailureReason,
    url: string,
    status: number | undefined,
    cause: unknown,
  ) {
    super(
      `payload-live-preview: preview read failed (${reason}${status === undefined ? '' : ` ${String(status)}`}) for ${url}`,
      {
        cause,
      },
    );
    this.name = 'PreviewFetchError';
    this.reason = reason;
    this.status = status;
    this.url = url;
  }
}

/** A `where` tree in Payload's REST query shape, e.g. `{ slug: { equals: 'about' } }`. */
export interface PreviewWhere {
  readonly [key: string]: PreviewWhere | string | number | boolean | readonly (string | number)[];
}

/** Options every read shares; `fetchDocument` and `fetchGlobal` add their target. */
export interface PreviewReadOptions {
  /**
   * The verdict from `authorizePreviewRequest()`, or `null` for a public
   * request. Required: it is the explicit draft decision. A real context
   * reads the draft and forwards the context's `payloadHeaders`; anything
   * else — `null`, a copied object, a JSON round trip — reads the published
   * document with no forwarded material.
   */
  readonly authorization: AuthorizedPreviewContext | null;
  readonly locale?: string;
  /** Extra headers for this read; the context's headers win on conflict. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Abort the read from the outside, e.g. with the request's own signal. */
  readonly signal?: AbortSignal;
  /** `'result'` (default) returns the failed result; `'throw'` throws `PreviewFetchError`. */
  readonly errorMode?: 'result' | 'throw';
}

export interface ReadDocumentOptions extends PreviewReadOptions {
  readonly collection: string;
  readonly where?: PreviewWhere;
}

export interface ReadGlobalOptions extends PreviewReadOptions {
  readonly global: string;
}

/** The runtime/adapter options this configuration implies — spread them into the adapter or client options. */
export interface PreviewRuntimeOptions {
  readonly serverURL: string;
  readonly apiRoute: string;
  readonly mergeDepth: number;
}

export interface PreviewServer {
  readonly config: Readonly<
    Required<Pick<PreviewServerConfig, 'serverURL' | 'apiRoute' | 'depth' | 'timeoutMs'>>
  >;
  /** `{ serverURL, apiRoute, mergeDepth }` — the same depth the reads use. */
  readonly runtimeOptions: PreviewRuntimeOptions;
  fetchDocument<T = Record<string, unknown>>(
    options: ReadDocumentOptions,
  ): Promise<PreviewFetchResult<T>>;
  fetchGlobal<T = Record<string, unknown>>(
    options: ReadGlobalOptions,
  ): Promise<PreviewFetchResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 250;

/**
 * Bind the Payload origin, route and depth once; read documents and globals
 * with an explicit authorization verdict.
 */
export function definePreview(config: PreviewServerConfig): PreviewServer {
  const serverURL = normalizeServerURL(config.serverURL);
  const route = config.apiRoute ?? '/api';
  const apiRoute = route.startsWith('/') ? route : `/${route}`;
  if (!Number.isInteger(config.depth) || config.depth < 0) {
    throw new Error(
      `payload-live-preview: depth must be a non-negative integer, got ${String(config.depth)}`,
    );
  }
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const resolved = Object.freeze({ serverURL, apiRoute, depth: config.depth, timeoutMs });
  const runtimeOptions = Object.freeze({ serverURL, apiRoute, mergeDepth: config.depth });
  const base = `${serverURL}${apiRoute}`;

  async function read<T>(
    url: string,
    options: PreviewReadOptions,
    draft: boolean,
  ): Promise<PreviewFetchResult<T>> {
    const fetchImpl: PreviewFetchFunction | undefined =
      config.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
    const startedAt = Date.now();
    const finish = (result: PreviewFetchResult<T>): PreviewFetchResult<T> => {
      const durationMs = Date.now() - startedAt;
      if (result.ok) {
        config.onDiagnostic?.({ kind: 'response', url, status: result.status, draft, durationMs });
        return result;
      }
      config.onDiagnostic?.({
        kind: 'failure',
        url,
        reason: result.reason,
        status: result.status,
        draft,
        durationMs,
      });
      if (options.errorMode === 'throw') {
        throw new PreviewFetchError(result.reason, url, result.status, result.cause);
      }
      return result;
    };
    if (fetchImpl === undefined) {
      return finish({ ok: false, reason: 'no-fetch', status: undefined, draft, cause: undefined });
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
    const context = isAuthorizedPreviewContext(options.authorization)
      ? options.authorization
      : null;
    let response: Awaited<ReturnType<PreviewFetchFunction>>;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          ...(options.headers ?? {}),
          ...(context?.payloadHeaders ?? {}),
        },
        signal,
      });
    } catch (cause) {
      return finish({
        ok: false,
        reason: failureReason(cause, options.signal),
        status: undefined,
        draft,
        cause,
      });
    }
    if (!response.ok) {
      return finish({
        ok: false,
        reason: 'http',
        status: response.status,
        draft,
        cause: undefined,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      return finish({ ok: false, reason: 'invalid-json', status: response.status, draft, cause });
    }
    return finish({ ok: true, data: body as T, draft, status: response.status });
  }

  function draftFor(options: PreviewReadOptions): boolean {
    return isAuthorizedPreviewContext(options.authorization);
  }

  function params(options: PreviewReadOptions, draft: boolean): URLSearchParams {
    const query = new URLSearchParams();
    query.set('depth', String(config.depth));
    if (draft) query.set('draft', 'true');
    if (options.locale !== undefined) query.set('locale', options.locale);
    return query;
  }

  return Object.freeze({
    config: resolved,
    runtimeOptions,
    async fetchDocument<T = Record<string, unknown>>(
      options: ReadDocumentOptions,
    ): Promise<PreviewFetchResult<T>> {
      const draft = draftFor(options);
      const query = params(options, draft);
      query.set('limit', '1');
      if (options.where !== undefined) appendWhere(query, options.where, ['where']);
      const url = `${base}/${encodeURIComponent(options.collection)}?${query.toString()}`;
      const result = await read<{ docs?: T[] }>(url, options, draft);
      if (!result.ok) return result;
      const first = result.data?.docs?.[0];
      return { ok: true, data: first ?? null, draft, status: result.status };
    },
    async fetchGlobal<T = Record<string, unknown>>(
      options: ReadGlobalOptions,
    ): Promise<PreviewFetchResult<T>> {
      const draft = draftFor(options);
      const url = `${base}/globals/${encodeURIComponent(options.global)}?${params(options, draft).toString()}`;
      return read<T>(url, options, draft);
    },
  });
}

function normalizeServerURL(serverURL: string): string {
  let url: URL;
  try {
    url = new URL(serverURL);
  } catch {
    throw new Error(`payload-live-preview: serverURL "${serverURL}" is not an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`payload-live-preview: serverURL must be http(s), got "${url.protocol}"`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function failureReason(
  cause: unknown,
  external: AbortSignal | undefined,
): PreviewFetchFailureReason {
  if (external?.aborted === true) return 'aborted';
  const name =
    typeof cause === 'object' && cause !== null ? (cause as { name?: unknown }).name : undefined;
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'aborted';
  return 'network';
}

function appendWhere(query: URLSearchParams, node: PreviewWhere, path: string[]): void {
  for (const [key, value] of Object.entries(node)) {
    const nextPath = [...path, key];
    if (typeof value === 'object' && !Array.isArray(value)) {
      // `Array.isArray` does not narrow a readonly array away; the cast says what the guard proved.
      appendWhere(query, value as PreviewWhere, nextPath);
      continue;
    }
    const name = nextPath
      .map((segment, index) => (index === 0 ? segment : `[${segment}]`))
      .join('');
    query.set(name, Array.isArray(value) ? value.map(String).join(',') : String(value));
  }
}
