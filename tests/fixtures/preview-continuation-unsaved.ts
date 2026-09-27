/**
 * Narrow application-side unsaved population contract for ADR 0019.
 * A saved read establishes root-document access before Payload processes form
 * data; browser input cannot select authority or bypass that independent read.
 */
import { definePreview } from '@/server/preview';
import { enrichRelatedDrafts, type RelatedDraftOptions } from './preview-related-drafts';
import type {
  ContinuationGrant,
  ContinuationWork,
  createReferenceContinuation,
} from './preview-continuation';
import {
  boundedFetch,
  cancel,
  identified,
  PRIVATE_HEADERS,
  readJSON,
  refuse,
  type ReferenceDataOptions,
} from './preview-continuation-data';

interface UnsavedInput {
  version: 1;
  revision: number;
  data: { title: string; related: number[]; files: number[] };
}
interface UnsavedOptions extends Pick<
  ReferenceDataOptions,
  'fetch' | 'define' | 'maxResponseBytes'
> {
  readonly maxRequestBytes?: number;
  readonly relatedDrafts?: RelatedDraftOptions;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function ids(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every((id: unknown) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  );
}
function valid(value: unknown): value is UnsavedInput {
  if (!object(value) || !keys(value, ['version', 'revision', 'data'])) return false;
  const data = value['data'];
  return (
    value['version'] === 1 &&
    typeof value['revision'] === 'number' &&
    Number.isSafeInteger(value['revision']) &&
    value['revision'] > 0 &&
    object(data) &&
    keys(data, ['title', 'related', 'files']) &&
    typeof data['title'] === 'string' &&
    ids(data['related']) &&
    ids(data['files'])
  );
}

async function read(
  grant: ContinuationGrant,
  work: ContinuationWork,
  options: UnsavedOptions,
  maxBytes: number,
  data?: Record<string, unknown>,
  consumeBytes?: (bytes: number) => void,
) {
  const { target, context } = grant;
  if (target.document.kind !== 'collection') return null;
  // Payload's draft replacement would overwrite these unsaved values, and
  // their locales are already flattened by the form, like the saved GET.
  const body =
    data === undefined
      ? undefined
      : await work.run(() => JSON.stringify({ data, draft: false, flattenLocales: false }));
  const fetch: typeof globalThis.fetch = (url, init) => {
    if (body === undefined) return options.fetch(url, init);
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    headers.set('x-payload-http-method-override', 'GET');
    return options.fetch(url, { ...init, method: 'POST', headers, body });
  };
  const io = boundedFetch(fetch, work, maxBytes, consumeBytes);
  try {
    const preview = (options.define ?? definePreview)({
      serverURL: target.serverURL,
      ...(target.apiRoute === undefined ? {} : { apiRoute: target.apiRoute }),
      depth: body === undefined || options.relatedDrafts !== undefined ? 0 : target.depth,
      fetch: io.fetch,
    });
    const result = await preview.fetchDocument({
      authorization: context,
      collection: target.document.slug,
      id: target.document.id,
      ...(target.locale === undefined ? {} : { locale: target.locale }),
      signal: work.signal,
    });
    return result.ok && identified(result.data, target, undefined) ? result.data : null;
  } finally {
    io.dispose();
  }
}

export function createReferenceUnsavedHandler(
  reference: ReturnType<typeof createReferenceContinuation>,
  options: UnsavedOptions,
) {
  const maxInput = options.maxRequestBytes ?? 65_536;
  const maxOutput = options.maxResponseBytes ?? 65_536;
  const maxReads = options.relatedDrafts?.maxReads ?? 64;
  const maxTotalBytes = options.relatedDrafts?.maxTotalBytes ?? 1_048_576;
  if (![maxInput, maxOutput].every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new TypeError('Invalid reference data byte limit');
  }
  if (
    !Number.isSafeInteger(maxReads) ||
    maxReads < 1 ||
    maxReads > 64 ||
    !Number.isSafeInteger(maxTotalBytes) ||
    maxTotalBytes < 1 ||
    maxTotalBytes > 1_048_576
  ) {
    throw new TypeError('Invalid related draft limit');
  }
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'POST') return refuse(405, 'invalid-request');
      const url = new URL(request.url);
      if (request.headers.get('origin') !== url.origin) return refuse(403, 'forbidden');
      const query = url.searchParams;
      if (
        Array.from(query.keys()).some((key) => key !== 'preview' && key !== 'locale') ||
        query.getAll('preview').length !== 1 ||
        query.get('preview') !== 'true'
      ) {
        return refuse(400, 'invalid-request');
      }
      const response = await reference.withGrant(request, async (grant, work) => {
        if (
          grant.target.document.kind !== 'collection' ||
          grant.target.document.slug !== 'articles'
        ) {
          return refuse(403, 'forbidden');
        }
        let input: unknown;
        try {
          input = await readJSON(request, work, maxInput);
        } catch {
          return work.run(() => refuse(400, 'invalid-request'));
        }
        if (!valid(input)) return refuse(400, 'invalid-request');
        let totalBytes = 0;
        const consumeBytes = (count: number) => {
          totalBytes += count;
          if (totalBytes > maxTotalBytes) throw new Error('Related draft byte limit');
        };
        const consume = options.relatedDrafts === undefined ? undefined : consumeBytes;
        const saved = await read(grant, work, options, maxOutput, undefined, consume);
        if (saved === null) return refuse(502, 'unavailable');
        // Native Payload may substitute data even when a filtered root read
        // found nothing. Only the preceding independent read supplies identity.
        const populated = await read(
          grant,
          work,
          options,
          maxOutput,
          { ...saved, ...input.data },
          consume,
        );
        if (populated !== null && options.relatedDrafts !== undefined) {
          try {
            const data = await enrichRelatedDrafts(populated, {
              request,
              grant,
              work,
              fetch: options.fetch,
              maxBytes: maxOutput,
              maxReads,
              consumeBytes,
              ...(options.define === undefined ? {} : { define: options.define }),
              ...(options.relatedDrafts.authorizeRequest === undefined
                ? {}
                : { authorizeRequest: options.relatedDrafts.authorizeRequest }),
            });
            return await work.run(() => {
              const body = JSON.stringify({ version: 1, ok: true, revision: input.revision, data });
              if (new TextEncoder().encode(body).byteLength > maxOutput) {
                return refuse(502, 'unavailable');
              }
              return new Response(body, {
                headers: { ...PRIVATE_HEADERS, 'content-type': 'application/json' },
              });
            });
          } catch {
            return work.run(() => refuse(502, 'unavailable'));
          }
        }
        return populated === null
          ? refuse(502, 'unavailable')
          : Response.json(
              { version: 1, ok: true, revision: input.revision, data: populated },
              { headers: PRIVATE_HEADERS },
            );
      });
      return response ?? refuse(403, 'forbidden');
    } finally {
      // Authorization can fail before acquiring the incoming reader.
      cancel(request.body);
    }
  };
}
