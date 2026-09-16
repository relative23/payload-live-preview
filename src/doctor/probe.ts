/**
 * Fetching for `pll doctor`: the two probes, and the default fetch that talks
 * to a real server. Not in the barrel so it stays in the coverage report.
 */
import { analyzeProbe } from './analyze';
import type { DoctorReport, DoctorResponse } from './types';

/** Injectable so tests can drive the audit without a server. */
export type DoctorFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<DoctorResponse>;

export interface RunDoctorOptions {
  readonly url: string;
  /** Admin origin the preview is meant to be embedded from, when known. */
  readonly adminOrigin?: string | undefined;
  /** Defaults to a fetch built on `globalThis.fetch`. */
  readonly fetchImpl?: DoctorFetch | undefined;
  /** Also check the served page against the 2.0 readiness table. */
  readonly v2?: boolean;
  /**
   * Headers sent with the preview probe only, never with the visitor probe: the
   * credentials a preview behind `authorizePreview` needs, such as a Payload
   * session `Cookie`, or an `x-preview-token` where the token strategy reads a
   * header (a token in the URL is passed in `url` instead). Without them a gated page answers
   * the audit the way it answers any stranger. Their values never reach the report.
   */
  readonly previewHeaders?: Readonly<Record<string, string>> | undefined;
  /**
   * The query parameters the deployment reads as preview intent, when its
   * adapter sets `previewQueryParams`; the same list, since that option replaces
   * the default `preview`, `draft` and `livePreview`. The first one is what the
   * preview probe appends as `=true`; none of them reaches the visitor probe.
   */
  readonly previewQueryParams?: readonly string[] | undefined;
}

/**
 * The query parameters an adapter reads as preview intent by default; the same
 * list as `DEFAULT_QUERY_PARAMS` in adapters/shared/preview-request.ts, which
 * `previewQueryParams` replaces rather than extends.
 */
const DEFAULT_INTENT_PARAMS: readonly string[] = ['preview', 'draft', 'livePreview'];

function isIntentValue(value: string): boolean {
  return value === 'true' || value === '1';
}

/** `key=value` and `#fragment` split off a URL, with the query kept as the caller spelled it. */
function splitUrl(url: string): {
  readonly base: string;
  readonly parts: string[];
  readonly hash: string;
} {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return { base: beforeHash, parts: [], hash };
  return {
    base: beforeHash.slice(0, queryAt),
    parts: beforeHash.slice(queryAt + 1).split('&'),
    hash,
  };
}

function decodePart(part: string): readonly [string, string] {
  const at = part.indexOf('=');
  const decode = (text: string): string => {
    try {
      return decodeURIComponent(text.replace(/\+/gu, ' '));
    } catch {
      return text;
    }
  };
  return at === -1 ? [decode(part), ''] : [decode(part.slice(0, at)), decode(part.slice(at + 1))];
}

/**
 * The page a visitor requests: the intent parameters removed, the rest of the
 * query byte for byte as given. A query is never re-serialised — `URLSearchParams`
 * would turn `%20` into `+` and add `=` to a bare key, and a page whose query is
 * signed by an edge token would answer a different request than a visitor makes.
 */
/**
 * The query parameter the `signed-token` strategy reads by default. A token
 * audit puts the token in the URL, and it belongs to the preview request only:
 * in the visitor request it would authorize the "anonymous" probe and, behind a
 * replay store, spend the token before the preview request arrives.
 */
const TOKEN_PARAM = 'previewToken';

function visitorUrl(url: string, params: readonly string[]): string {
  const { base, parts, hash } = splitUrl(url);
  const dropped = new Set([...params, TOKEN_PARAM]);
  const kept = parts.filter((part) => !dropped.has(decodePart(part)[0]));
  if (kept.length === parts.length) return url;
  return `${base}${kept.length === 0 ? '' : `?${kept.join('&')}`}${hash}`;
}

/**
 * The page the admin's iframe loads. A 2.0 adapter counts only the query as
 * intent (`previewSignals: ['query']`), and `buildLivePreviewUrl` writes
 * `preview=true`, so the first intent parameter is appended as `=true` unless the
 * URL already names one with a value that counts.
 */
function previewUrl(url: string, params: readonly string[]): string {
  const { base, parts, hash } = splitUrl(url);
  const carries = parts.some((part) => {
    const [key, value] = decodePart(part);
    return params.includes(key) && isIntentValue(value);
  });
  if (carries) return url;
  const query = parts.join('&');
  const joiner = query === '' ? '?' : query.endsWith('&') ? '' : '&';
  const intent = `${encodeURIComponent(params[0] ?? 'preview')}=true`;
  return `${base}${parts.length === 0 ? '?' : `?${query}${joiner}`}${intent}${hash}`;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface DefaultFetchOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

/** Header names lowercased; every check downstream reads a lowercase key. @internal */
export function lowercaseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** The error's message plus its cause's, which is where undici puts `self-signed certificate` and friends. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message !== '' && !error.message.includes(cause.message)) {
    return `${error.message} (${cause.message})`;
  }
  return error.message;
}

async function readBody(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return response.text();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new Error(
        `the response body exceeds ${String(limit)} bytes, which is not a page the audit can judge`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Redirects are reported, not followed; a hanging origin is abandoned; a runaway body is refused. */
export function createDefaultFetch(options: DefaultFetchOptions = {}): DoctorFetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = options.maxBodyBytes ?? MAX_BODY_BYTES;
  return async (url, init) => {
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: init.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`no response within ${String(timeoutMs / 1000)} s`, { cause: error });
      }
      throw error;
    }
    return {
      status: response.status,
      headers: lowercaseHeaders(response.headers),
      body: await readBody(response, limit),
    };
  };
}

/** The referer the admin's iframe would send: the origin (or the given admin path) with one slash. */
export function previewReferer(adminOrigin: string): string {
  try {
    return new URL(adminOrigin).href;
  } catch {
    return `${adminOrigin.replace(/\/+$/u, '')}/`;
  }
}

/**
 * The caller's headers without the ones the probe sets itself. Header names are
 * case-insensitive, and `fetch` combines two spellings of one name into one
 * comma-joined value, so a caller's `sec-fetch-dest` would otherwise turn the
 * probe's `iframe` into `document, iframe`. The probe's own headers win.
 */
function callerHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  own: Readonly<Record<string, string>>,
): Record<string, string> {
  const taken = new Set(Object.keys(own).map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => !taken.has(name.toLowerCase())),
  );
}

/** Fetch the URL twice — as a visitor and as the admin's iframe — and audit the difference. */
export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  const fetchImpl = options.fetchImpl ?? createDefaultFetch();
  const params =
    options.previewQueryParams === undefined || options.previewQueryParams.length === 0
      ? DEFAULT_INTENT_PARAMS
      : options.previewQueryParams;
  // No referer, no intent parameter and no credentials on the visitor probe:
  // each of them is a preview signal or a way past one.
  const publicResponse = await fetchImpl(visitorUrl(options.url, params), {
    headers: {
      Accept: 'text/html',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
  });
  const probeHeaders: Record<string, string> = {
    Accept: 'text/html',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    ...(options.adminOrigin === undefined ? {} : { Referer: previewReferer(options.adminOrigin) }),
  };
  const sent = callerHeaders(options.previewHeaders, probeHeaders);
  const previewResponse = await fetchImpl(previewUrl(options.url, params), {
    headers: { ...sent, ...probeHeaders },
  });
  return analyzeProbe(
    { publicResponse, previewResponse },
    {
      url: options.url,
      adminOrigin: options.adminOrigin,
      ...(options.v2 === true ? { v2: true } : {}),
      ...(Object.keys(sent).length > 0 ? { credentials: true } : {}),
    },
  );
}
