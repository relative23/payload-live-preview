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
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface DefaultFetchOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

/** Header names lowercased; every check downstream reads a lowercase key. */
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

/** Fetch the URL twice — as a visitor and as the admin's iframe — and audit the difference. */
export async function runDoctor(options: RunDoctorOptions): Promise<DoctorReport> {
  const fetchImpl = options.fetchImpl ?? createDefaultFetch();
  // No referer on the visitor probe: an admin referer is itself a preview signal.
  const publicResponse = await fetchImpl(options.url, {
    headers: {
      Accept: 'text/html',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    },
  });
  const previewResponse = await fetchImpl(options.url, {
    headers: {
      Accept: 'text/html',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      ...(options.adminOrigin === undefined
        ? {}
        : { Referer: previewReferer(options.adminOrigin) }),
    },
  });
  return analyzeProbe(
    { publicResponse, previewResponse },
    {
      url: options.url,
      adminOrigin: options.adminOrigin,
      ...(options.v2 === true ? { v2: true } : {}),
    },
  );
}
