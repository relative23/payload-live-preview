/**
 * The fragment wire protocol: what the browser posts to a fragment endpoint
 * and what it answers. Both sides validate the shape; nothing on the wire
 * names code, paths or templates. See ADR 0011.
 */

/** Bumped when the request or response shape changes incompatibly. */
export const FRAGMENT_PROTOCOL_VERSION = 1;
export const FRAGMENT_VERSION_HEADER = 'x-payload-fragment-version';

export interface FragmentRequestBody {
  /** Registry id of the boundary (`data-payload-fragment`). */
  readonly fragment: string;
  /** `data-payload-fragment-key`, when several boundaries share one id. */
  readonly key?: string;
  /** The page route the boundary belongs to; authorization is bound to it. */
  readonly route: string;
  /** The page's query string, so a `previewToken` in the URL reaches the endpoint. */
  readonly search: string;
  readonly revision: number;
  readonly locale?: string;
  readonly collectionSlug?: string;
  readonly globalSlug?: string;
  /** The unsaved form state as the admin posted it, after the runtime's merge. */
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface FragmentResponseBody {
  /** The boundary's new inner HTML. */
  readonly html: string;
  readonly boundary: { readonly id: string; readonly key?: string };
  /** Echoes the request; the client discards a response for another revision. */
  readonly revision: number;
  readonly metadata: {
    readonly renderedAt: string;
    /** What rendered it, e.g. `astro-container`. */
    readonly renderer: string;
    readonly durationMs?: number;
  };
}

const MAX_FIELD_DEPTH = 12;

function depthOf(value: unknown, depth: number): number {
  if (depth > MAX_FIELD_DEPTH || typeof value !== 'object' || value === null) return depth;
  let deepest = depth;
  for (const child of Object.values(value)) {
    deepest = Math.max(deepest, depthOf(child, depth + 1));
    if (deepest > MAX_FIELD_DEPTH) break;
  }
  return deepest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape check for a request body; `null` when it is not one. */
export function parseFragmentRequest(value: unknown): FragmentRequestBody | null {
  if (!isRecord(value)) return null;
  const fragment = value['fragment'];
  if (typeof fragment !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/iu.test(fragment)) return null;
  const key = value['key'];
  if (key !== undefined && (typeof key !== 'string' || key.length > 128)) return null;
  const route = value['route'];
  if (typeof route !== 'string' || !route.startsWith('/') || route.length > 2048) return null;
  const search = value['search'];
  if (
    typeof search !== 'string' ||
    search.length > 4096 ||
    (search !== '' && !search.startsWith('?'))
  ) {
    return null;
  }
  const revision = value['revision'];
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  const slugs: (string | undefined)[] = [];
  for (const name of ['locale', 'collectionSlug', 'globalSlug'] as const) {
    const slug = value[name];
    if (slug === undefined) {
      slugs.push(undefined);
      continue;
    }
    if (typeof slug !== 'string' || slug.length > 128) return null;
    slugs.push(slug);
  }
  const [locale, collectionSlug, globalSlug] = slugs;
  const fields = value['fields'];
  if (!isRecord(fields) || depthOf(fields, 0) > MAX_FIELD_DEPTH) return null;
  return {
    fragment,
    ...(typeof key === 'string' ? { key } : {}),
    route,
    search,
    revision,
    ...(locale !== undefined ? { locale } : {}),
    ...(collectionSlug !== undefined ? { collectionSlug } : {}),
    ...(globalSlug !== undefined ? { globalSlug } : {}),
    fields,
  };
}

/** Shape check for a response body; `null` when it is not one. */
export function parseFragmentResponse(value: unknown): FragmentResponseBody | null {
  if (!isRecord(value)) return null;
  const { html, boundary, revision, metadata } = value;
  if (typeof html !== 'string') return null;
  if (!isRecord(boundary) || typeof boundary['id'] !== 'string') return null;
  if (boundary['key'] !== undefined && typeof boundary['key'] !== 'string') return null;
  if (typeof revision !== 'number') return null;
  if (
    !isRecord(metadata) ||
    typeof metadata['renderedAt'] !== 'string' ||
    typeof metadata['renderer'] !== 'string'
  ) {
    return null;
  }
  return value as unknown as FragmentResponseBody;
}
