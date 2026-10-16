/**
 * Shared checks for an opt-in Payload document capability (ADR 0006 §5c).
 * The verifier supplies authority; server reads and fragments only compare
 * their requested target against it, before forwarding credentials or rendering.
 */
import type {
  AuthorizedPreviewContext,
  AuthorizedPreviewDocument,
  AuthorizedPreviewPayloadScope,
} from '@/types/authorized-preview';

function pathSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !/[\s\p{Cc}\p{Cs}/\\?#%]/u.test(value)
  );
}

/** @internal Numeric REST IDs and their string spelling name the same document. */
export function isPreviewDocumentID(value: unknown): value is string | number {
  return typeof value === 'number' ? Number.isSafeInteger(value) : pathSegment(value);
}

/** @internal Refuse ambiguous paths rather than depending on a proxy's decoding rules. */
export function payloadAPIBase(serverURL: unknown, apiRoute: unknown = '/api'): string | null {
  if (typeof serverURL !== 'string' || typeof apiRoute !== 'string') return null;
  try {
    const url = new URL(serverURL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    // Inspect the raw path too: URL would otherwise erase dot segments first.
    const rawPath = serverURL.replace(/^[a-z]+:\/\/[^/]+/iu, '').replace(/\/+$/, '');
    const route = apiRoute.replace(/^\//, '').replace(/\/$/, '');
    if (
      (rawPath !== '' && !rawPath.slice(1).split('/').every(pathSegment)) ||
      !route.split('/').every(pathSegment)
    ) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${route}`;
  } catch {
    return null;
  }
}

/** @internal Validate a JavaScript verifier's binding, not merely its TypeScript shape. */
export function isValidPayloadScope(value: unknown): value is AuthorizedPreviewPayloadScope {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as Record<string, unknown>;
  const document = scope['document'] as Record<string, unknown> | null | undefined;
  if (
    payloadAPIBase(scope['serverURL'], scope['apiRoute']) === null ||
    typeof scope['maxDepth'] !== 'number' ||
    !Number.isSafeInteger(scope['maxDepth']) ||
    scope['maxDepth'] < 0 ||
    typeof document !== 'object' ||
    document === null ||
    !pathSegment(document['slug'])
  ) {
    return false;
  }
  return (
    document['kind'] === 'global' ||
    (document['kind'] === 'collection' && isPreviewDocumentID(document['id']))
  );
}

/** @internal No clock renewal: every consumer checks the original absolute expiry. */
export function isPayloadScopeCurrent(context: AuthorizedPreviewContext): boolean {
  return (
    context.expiresAt !== undefined &&
    Number.isFinite(context.expiresAt) &&
    context.expiresAt > Date.now()
  );
}

/** @internal Both package consumers use the same kind/slug/ID comparison. */
export function matchesPreviewDocument(
  expected: AuthorizedPreviewDocument,
  actual: {
    readonly kind: 'collection' | 'global';
    readonly slug: string | undefined;
    readonly id?: unknown;
  },
): boolean {
  return (
    expected.kind === actual.kind &&
    expected.slug === actual.slug &&
    (expected.kind === 'global' ||
      (isPreviewDocumentID(actual.id) && String(expected.id) === String(actual.id)))
  );
}

/** @internal A document response or form snapshot cannot contradict its bound identity. */
export function matchesPreviewDocumentData(
  expected: AuthorizedPreviewDocument,
  value: unknown,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (expected.kind === 'global') {
    return !Object.hasOwn(data, 'globalType') || data['globalType'] === expected.slug;
  }
  return (
    Object.hasOwn(data, 'id') &&
    matchesPreviewDocument(expected, { kind: 'collection', slug: expected.slug, id: data['id'] })
  );
}
