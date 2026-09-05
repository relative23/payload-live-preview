/**
 * The HTTP handler behind `createFragmentStrategy()`: one POST per boundary and
 * revision, shared, gated, timed out and size-bounded. Every failure is an
 * `LP08xx` outcome, never an exception. See ADR 0011.
 */

import type { DiagnosticCode } from '@core/diagnostic-codes';
import {
  FRAGMENT_PROTOCOL_VERSION,
  FRAGMENT_VERSION_HEADER,
  parseFragmentResponse,
  type FragmentRequestBody,
} from '@/types/fragment-protocol';
import { definedOnly } from '@/types/defined-only';
import { errorMessage, linkedTimeout } from './abort';
import type {
  FragmentBoundary,
  FragmentHandler,
  FragmentOutcome,
  StrategyRequest,
} from './boundary';
import { createGate } from './gate';

export interface FragmentStrategyOptions {
  /** Same-origin path of the fragment endpoint, e.g. `/payload/fragment`. */
  readonly endpoint: string;
  /** `fetch` to use; defaults to the global one. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Per-request timeout. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Requests in flight at once; further boundaries wait. Default 4. */
  readonly maxConcurrent?: number;
  /** Largest response body accepted, in bytes. Default 512 KiB. */
  readonly maxResponseBytes?: number;
  /** Extra request headers, e.g. a CSRF token the site already uses. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Where the page lives; defaults to `location`. */
  readonly location?: {
    readonly pathname: string;
    readonly search: string;
  };
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const SUPERSEDED: FragmentOutcome = { status: 'superseded' };

function failed(code: DiagnosticCode, reason: string): FragmentOutcome {
  return { status: 'failed', code, reason };
}

/**
 * `endpoint` must stay on the page's origin. The URL parser reads `\` as `/`,
 * so `/\evil.com/x` leaves it; the resolved origin decides.
 */
function sameOriginPath(endpoint: string): string {
  const refuse = (): never => {
    throw new TypeError(
      'createFragmentStrategy: endpoint must be a same-origin path starting with "/"',
    );
  };
  if (
    typeof endpoint !== 'string' ||
    !endpoint.startsWith('/') ||
    endpoint.startsWith('//') ||
    endpoint.includes('\\')
  ) {
    refuse();
  }
  if (typeof location !== 'undefined') {
    let resolved: URL | undefined;
    try {
      resolved = new URL(endpoint, location.href);
    } catch {
      resolved = undefined;
    }
    if (resolved?.origin !== location.origin) refuse();
  }
  return endpoint;
}

function isByteStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getReader?: unknown }).getReader === 'function'
  );
}

/**
 * The body as text, or `null` past `maxBytes` — counted as bytes arrive, so an
 * oversized answer is cut off rather than buffered. An abort cancels the
 * stream, which ends a pending read instead of hanging it.
 */
async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string | null> {
  const stream: unknown = response.body;
  if (!isByteStream(stream)) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
  }
  const reader = stream.getReader();
  const cancel = (): void => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  return text + decoder.decode();
}

export function createFragmentHandler(options: FragmentStrategyOptions): FragmentHandler {
  const endpoint = sameOriginPath(options.endpoint);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const gate = createGate(Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
  const inFlight = new Map<string, Promise<FragmentOutcome>>();

  async function render(
    request: StrategyRequest,
    boundary: FragmentBoundary,
  ): Promise<FragmentOutcome> {
    // Read through a function: the signal flips during awaits, which narrowing cannot see.
    const superseded = (): boolean => request.signal.aborted;
    if (superseded()) return SUPERSEDED;
    const where = options.location ?? location;
    const body: FragmentRequestBody = definedOnly({
      fragment: boundary.id,
      key: boundary.key,
      route: where.pathname,
      search: where.search,
      revision: request.revision,
      locale: request.locale,
      collectionSlug: request.collectionSlug,
      globalSlug: request.globalSlug,
      fields: request.fields,
    });
    const timeout = linkedTimeout(request.signal, timeoutMs);
    const failure = (error: unknown): FragmentOutcome => {
      if (superseded()) return SUPERSEDED;
      if (timeout.timedOut()) return failed('LP0801', `timeout after ${String(timeoutMs)} ms`);
      return failed('LP0801', errorMessage(error));
    };
    try {
      let response: Response;
      try {
        response = await (options.fetch ?? fetch)(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            ...options.headers,
            accept: 'application/json',
            'content-type': 'application/json',
            [FRAGMENT_VERSION_HEADER]: String(FRAGMENT_PROTOCOL_VERSION),
          },
          body: JSON.stringify(body),
          signal: timeout.signal,
        });
      } catch (error) {
        return failure(error);
      }
      if (superseded()) return SUPERSEDED;
      if (response.status === 401 || response.status === 403) {
        return failed('LP0803', `endpoint refused the preview (${String(response.status)})`);
      }
      if (!response.ok) return failed('LP0801', `endpoint answered ${String(response.status)}`);
      const type = response.headers.get('content-type') ?? '';
      if (!type.toLowerCase().startsWith('application/json')) {
        return failed('LP0802', `unexpected content type "${type}"`);
      }
      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > maxResponseBytes) return failed('LP0802', 'response exceeds the size limit');
      let text: string | null;
      try {
        text = await readBoundedText(response, maxResponseBytes, timeout.signal);
      } catch (error) {
        return failure(error);
      }
      if (superseded()) return SUPERSEDED;
      if (timeout.timedOut()) return failed('LP0801', `timeout after ${String(timeoutMs)} ms`);
      if (text === null) return failed('LP0802', 'response exceeds the size limit');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return failed('LP0802', 'response is not JSON');
      }
      const fragment = parseFragmentResponse(parsed);
      if (fragment === null) return failed('LP0802', 'response has the wrong shape');
      if (fragment.boundary.id !== boundary.id) {
        return failed('LP0802', 'response is for another boundary');
      }
      if (fragment.revision !== request.revision) return SUPERSEDED;
      return { status: 'rendered', html: fragment.html, metadata: fragment.metadata };
    } finally {
      timeout.dispose();
    }
  }

  return (request, boundary) => {
    // Identical boundary and revision share one request: same id and key render the same HTML.
    const dedupeKey = `${boundary.id} ${boundary.key ?? ''} ${String(request.revision)}`;
    const shared = inFlight.get(dedupeKey);
    if (shared !== undefined) return shared;
    const promise = gate(() => render(request, boundary));
    inFlight.set(dedupeKey, promise);
    const forget = (): void => {
      if (inFlight.get(dedupeKey) === promise) inFlight.delete(dedupeKey);
    };
    void promise.then(forget, forget);
    return promise;
  };
}
