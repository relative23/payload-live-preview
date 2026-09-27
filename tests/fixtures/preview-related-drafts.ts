/**
 * The application's fixed field graph authorizes exact related targets.
 * Each target still crosses Payload's current user ACL; the root capability
 * is neither widened nor reused. Reads are sequential and request-local.
 */
import { authorizePreviewRequest } from '@security/preview-authorization';
import { definePreview } from '@/server/preview';
import type { ContinuationGrant, ContinuationWork } from './preview-continuation';
import { boundedFetch } from './preview-continuation-data';

export interface RelatedDraftOptions {
  readonly authorizeRequest?: typeof authorizePreviewRequest;
  readonly maxReads?: number;
  readonly maxTotalBytes?: number;
}
interface Composition {
  readonly request: Request;
  readonly grant: ContinuationGrant;
  readonly work: ContinuationWork;
  readonly fetch: typeof fetch;
  readonly define?: typeof definePreview;
  readonly authorizeRequest?: typeof authorizePreviewRequest;
  readonly maxBytes: number;
  readonly maxReads: number;
  readonly consumeBytes: (bytes: number) => void;
}
interface Sized {
  readonly data: Record<string, unknown> | number;
  readonly bytes: number;
}
const size = (data: unknown): number => new TextEncoder().encode(JSON.stringify(data)).byteLength;
const invalid = (): never => {
  throw new Error('Related draft unavailable');
};
function id(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : invalid();
}

export async function enrichRelatedDrafts(
  root: Record<string, unknown>,
  options: Composition,
): Promise<Record<string, unknown>> {
  const {
    grant: { target, context },
    work,
  } = options;
  const cache = new Map<string, Sized>();
  let reads = 0;
  async function read(
    collection: 'records' | 'media',
    value: unknown,
    depth: number,
  ): Promise<Sized> {
    const selected = id(value);
    if (depth === 0) return { data: selected, bytes: size(selected) };
    const key = `${collection}/${selected}/${depth}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (++reads > options.maxReads) return invalid();
    // Authority comes from the fixed field graph below plus the verified
    // current principal. A parent document grant alone is not delegation.
    const verdict = await work.run(() =>
      (options.authorizeRequest ?? authorizePreviewRequest)(
        { url: options.request.url, headers: options.request.headers, signal: work.signal },
        {
          type: 'verifier',
          verify: () => ({
            ...(context.subject === undefined ? {} : { subject: context.subject }),
            ...(context.expiresAt === undefined ? {} : { expiresAt: context.expiresAt }),
            scope: {
              audience: target.audience,
              path: target.path,
              ...(target.locale === undefined ? {} : { locale: target.locale }),
              payload: {
                serverURL: target.serverURL,
                ...(target.apiRoute === undefined ? {} : { apiRoute: target.apiRoute }),
                document: { kind: 'collection', slug: collection, id: selected },
                maxDepth: 0,
              },
            },
            payloadHeaders: context.payloadHeaders,
          }),
        },
      ),
    );
    if (!verdict.authorized) return invalid();
    const io = boundedFetch(options.fetch, work, options.maxBytes, options.consumeBytes);
    let result;
    try {
      const preview = (options.define ?? definePreview)({
        serverURL: target.serverURL,
        ...(target.apiRoute === undefined ? {} : { apiRoute: target.apiRoute }),
        depth: 0,
        fetch: io.fetch,
      });
      result = await preview.fetchDocument({
        authorization: verdict.context,
        collection,
        id: selected,
        ...(target.locale === undefined ? {} : { locale: target.locale }),
        signal: work.signal,
      });
    } finally {
      io.dispose();
    }
    let resolved: Sized;
    if (!result.ok) {
      if (result.reason !== 'http' || ![403, 404].includes(result.status ?? 0)) return invalid();
      resolved = { data: selected, bytes: size(selected) };
    } else {
      const data = result.data;
      if (
        data === null ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data['id'] !== selected
      ) {
        return invalid();
      }
      resolved = await expand(data, collection, depth - 1);
    }
    cache.set(key, resolved);
    return resolved;
  }

  async function expand(
    data: Record<string, unknown>,
    kind: 'articles' | 'records' | 'media',
    depth: number,
  ): Promise<Sized> {
    const result = { ...data };
    let bytes = size(data);
    if (bytes > options.maxBytes) return invalid();
    const replace = async (field: string, collection: 'records' | 'media', many: boolean) => {
      // Never use the submitted form to restore an absent native field.
      if (!Object.hasOwn(data, field) || data[field] === null) return;
      const original = data[field];
      const values = many ? original : [original];
      if (!Array.isArray(values) || values.length > 32) return invalid();
      const populated: Sized['data'][] = [];
      for (const value of values) {
        const related = await read(collection, value, depth);
        // Bound repeated expansion before constructing an oversized tree or
        // serializing it. Cached reads still consume output bytes per edge.
        bytes += related.bytes - size(value);
        if (bytes > options.maxBytes) return invalid();
        populated.push(related.data);
      }
      result[field] = many ? populated : populated[0];
    };
    if (kind === 'articles') {
      await replace('related', 'records', true);
      await replace('files', 'media', true);
    } else if (kind === 'records') await replace('next', 'records', false);
    return { data: result, bytes };
  }
  const result = await work.run(() => expand(root, 'articles', target.depth));
  if (typeof result.data === 'number') return invalid();
  return result.data;
}
