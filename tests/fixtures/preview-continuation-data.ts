/**
 * Application-side data-read composition for the ADR 0019 reference.
 * This is not a public proxy or merge protocol; the package's direct REST
 * reader still owns the draft read and its document capability checks.
 */
import { definePreview, type PreviewFetchFunction } from '@/server/preview';
import type {
  ContinuationTarget,
  ContinuationWork,
  createReferenceContinuation,
} from './preview-continuation';

export interface ReferenceDataOptions {
  readonly fetch: typeof fetch;
  readonly maxResponseBytes?: number;
  readonly define?: typeof definePreview;
  /** Trusted application schema for globals whose response omits globalType. */
  readonly globalDocument?: (data: Record<string, unknown>, slug: string) => boolean;
}

export const PRIVATE_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie',
};

export function refuse(
  status: number,
  error: 'forbidden' | 'unavailable' | 'invalid-request',
): Response {
  return Response.json({ version: 1, ok: false, error }, { status, headers: PRIVATE_HEADERS });
}

export function cancel(body: ReadableStream<Uint8Array> | null): void {
  // A remote producer may never acknowledge cancellation; cleanup cannot wait
  // for it or leak its rejection into a different request.
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    /* Already locked/closed. */
  }
}

export async function readJSON(
  response: Pick<Response, 'headers' | 'body'>,
  work: ContinuationWork,
  maxBytes: number,
  consumeBytes?: (bytes: number) => void,
): Promise<unknown> {
  if (
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
      'application/json' ||
    response.body === null
  ) {
    cancel(response.body);
    throw new Error('Invalid reference data response');
  }
  const reader = response.body.getReader();
  let ended = false;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    for (;;) {
      const part = await work.run(() => reader.read());
      if (part.done) {
        ended = true;
        break;
      }
      bytes += part.value.byteLength;
      consumeBytes?.(part.value.byteLength);
      if (bytes > maxBytes) throw new Error('Reference data response too large');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return await work.run(() => JSON.parse(text) as unknown);
  } finally {
    if (!ended) {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* Already closed. */
      }
    }
    reader.releaseLock();
  }
}

export function boundedFetch(
  fetch: typeof globalThis.fetch,
  work: ContinuationWork,
  maxBytes: number,
  consumeBytes?: (bytes: number) => void,
) {
  const unread = new Set<ReadableStream<Uint8Array>>();
  const read: PreviewFetchFunction = async (url, init) => {
    const response = await work.run(async () => {
      const result = await fetch(url, init);
      // A fetch implementation can ignore abort and return a body after the
      // caller has already gone. Do not acquire/read it, but cancel it.
      if (init.signal.aborted) {
        cancel(result.body);
        throw new Error('Reference data read stopped');
      }
      if (result.body !== null) unread.add(result.body);
      return result;
    });
    if (!response.ok && response.body !== null) {
      unread.delete(response.body);
      cancel(response.body);
    }
    return {
      ok: response.ok,
      status: response.status,
      json: () => {
        if (response.body !== null) unread.delete(response.body);
        return readJSON(response, work, maxBytes, consumeBytes);
      },
    };
  };
  return {
    fetch: read,
    dispose: () => {
      unread.forEach(cancel);
      unread.clear();
    },
  };
}

export function identified(
  data: unknown,
  target: ContinuationTarget,
  globalDocument: ReferenceDataOptions['globalDocument'],
): data is Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as Record<string, unknown>;
  const document = target.document;
  // This opt-in reference expects full documents, not projected REST records.
  // A field named errors is content; missing identity is ambiguity, not proof
  // that Payload has returned an error envelope.
  return document.kind === 'collection'
    ? Object.hasOwn(value, 'id') &&
        (typeof value['id'] === 'string' || typeof value['id'] === 'number') &&
        String(value['id']) === document.id
    : (Object.hasOwn(value, 'globalType') && value['globalType'] === document.slug) ||
        (!Object.hasOwn(value, 'globalType') && globalDocument?.(value, document.slug) === true);
}

export function createReferenceDataHandler(
  reference: ReturnType<typeof createReferenceContinuation>,
  options: ReferenceDataOptions,
) {
  const maxBytes = options.maxResponseBytes ?? 65_536;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('Invalid reference data byte limit');
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return refuse(405, 'invalid-request');
    const query = new URL(request.url).searchParams;
    if (
      Array.from(query.keys()).some((key) => key !== 'preview' && key !== 'locale') ||
      query.getAll('preview').length !== 1 ||
      query.get('preview') !== 'true'
    ) {
      return refuse(400, 'invalid-request');
    }
    const response = await reference.withGrant(request, async ({ target, context }, work) => {
      const io = boundedFetch(options.fetch, work, maxBytes);
      try {
        const preview = (options.define ?? definePreview)({
          serverURL: target.serverURL,
          ...(target.apiRoute === undefined ? {} : { apiRoute: target.apiRoute }),
          depth: target.depth,
          fetch: io.fetch,
        });
        const read = {
          authorization: context,
          ...(target.locale === undefined ? {} : { locale: target.locale }),
          signal: work.signal,
        };
        const result =
          target.document.kind === 'collection'
            ? await preview.fetchDocument({
                ...read,
                collection: target.document.slug,
                id: target.document.id,
              })
            : await preview.fetchGlobal({ ...read, global: target.document.slug });
        return result.ok && identified(result.data, target, options.globalDocument)
          ? Response.json({ version: 1, ok: true, data: result.data }, { headers: PRIVATE_HEADERS })
          : refuse(502, 'unavailable');
      } finally {
        // The package may refuse expired capabilities before calling json().
        io.dispose();
      }
    });
    return response ?? refuse(403, 'forbidden');
  };
}
