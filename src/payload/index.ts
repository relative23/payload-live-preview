/**
 * `payload-live-preview/payload` — helpers for `payload.config.ts`. It never
 * imports `payload`, only produces the callback `admin.livePreview.url` expects.
 */

/** Arguments Payload passes to `admin.livePreview.url`. */
export interface LivePreviewUrlArgs {
  readonly data: Record<string, unknown>;
  readonly locale?: string | { readonly code?: string | null; readonly [extra: string]: unknown };
  readonly collectionConfig?: { readonly slug: string };
  readonly globalConfig?: { readonly slug: string };
  /** Payload 2 identifies the edited entity here instead of through the top-level configs. */
  readonly documentInfo?: {
    readonly collection?: {
      /** Payload 2 inherits this runtime value through a mapped config type. */
      readonly slug?: string;
      /** Structural anchor for Payload 2's published sanitized config type. */
      readonly fields?: unknown;
    };
    readonly global?: {
      /** Payload 2 inherits this runtime value through a mapped config type. */
      readonly slug?: string;
      /** Structural anchor for Payload 2's published sanitized config type. */
      readonly fields?: unknown;
    };
  };
  readonly [extra: string]: unknown;
}

/** Context handed to per-slug path resolvers. */
export interface PathResolverContext {
  readonly data: Record<string, unknown>;
  /** Normalised locale code, or `undefined`. */
  readonly locale: string | undefined;
}

export type PathResolver = string | ((context: PathResolverContext) => string);

/** A resolver that may decline a document: `null` means no preview target; `''` falls back. */
export type NullablePathResolver =
  string | null | ((context: PathResolverContext) => string | null);

export interface BuildLivePreviewUrlOptions {
  /** Frontend origin, e.g. `https://site.example`. */
  readonly baseUrl: string;
  /** Per-collection path resolvers keyed by collection slug. */
  readonly collections?: Readonly<Record<string, PathResolver>>;
  /** Per-global path resolvers keyed by global slug. */
  readonly globals?: Readonly<Record<string, PathResolver>>;
  /** Path when no resolver matches or one returns `''` (a draft without a slug). Default `/`. */
  readonly fallback?: string;
  /** Query parameter signalling preview intent; keep it in the adapter's `previewQueryParams`. Client-controlled, so it authorizes nothing. Default `'preview'`, `null` disables it. */
  readonly previewParam?: string | null;
}

/**
 * Like {@link BuildLivePreviewUrlOptions} with nullable resolvers: the callback
 * may return `null`, and no iframe beats one pointing at a public page.
 */
export interface BuildLivePreviewUrlNullableOptions {
  readonly baseUrl: string;
  readonly collections?: Readonly<Record<string, NullablePathResolver>>;
  readonly globals?: Readonly<Record<string, NullablePathResolver>>;
  /** `null` declines every unmapped document. Default `/`. */
  readonly fallback?: string | null;
  /** See {@link BuildLivePreviewUrlOptions.previewParam}. */
  readonly previewParam?: string | null;
}

/** Build an `admin.livePreview.url` callback from slug → path mappings. */
export function buildLivePreviewUrl(
  options: BuildLivePreviewUrlOptions,
): (args: LivePreviewUrlArgs) => string;
export function buildLivePreviewUrl(
  options: BuildLivePreviewUrlNullableOptions,
): (args: LivePreviewUrlArgs) => string | null;
export function buildLivePreviewUrl(
  options: BuildLivePreviewUrlNullableOptions,
): (args: LivePreviewUrlArgs) => string | null {
  const base = options.baseUrl.replace(/\/+$/, '');
  // `??` would swallow an explicit `null`, which is the whole point of the nullable form.
  const fallback = options.fallback === undefined ? '/' : options.fallback;
  const previewParam = options.previewParam === undefined ? 'preview' : options.previewParam;

  return (args) => {
    const locale = normaliseLocale(args.locale);
    const context: PathResolverContext = { data: args.data, locale };
    const entry = findResolver(options, args);

    let path: string | null = fallback;
    if (entry !== undefined) {
      const resolved = typeof entry === 'function' ? entry(context) : entry;
      if (resolved === null) return null;
      if (resolved.length > 0) path = resolved;
    }
    if (path === null) return null;
    if (!path.startsWith('/')) path = `/${path}`;
    return `${base}${previewParam === null ? path : withPreviewParam(path, previewParam)}`;
  };
}

/** `path` with `<name>=true` in its query — ahead of any `#fragment`, and not twice. */
function withPreviewParam(path: string, name: string): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);
  const values = new URLSearchParams(query).getAll(name);
  if (values[values.length - 1] === 'true') return path;
  const separator = queryAt === -1 ? '?' : query.length === 0 || query.endsWith('&') ? '' : '&';
  return `${beforeHash}${separator}${encodeURIComponent(name)}=true${hash}`;
}

/** The mapped resolver, or `undefined` when the slug is not mapped; a mapped `null` is a resolver in its own right. */
function findResolver(
  options: BuildLivePreviewUrlNullableOptions,
  args: LivePreviewUrlArgs,
): NullablePathResolver | undefined {
  // Payload 3's explicit callback arguments win as a pair. Looking through a
  // stale `documentInfo` when either is present could select the wrong entity.
  if (args.collectionConfig !== undefined || args.globalConfig !== undefined) {
    return findResolverBySlug(options, args.collectionConfig?.slug, args.globalConfig?.slug);
  }
  return findResolverBySlug(
    options,
    args.documentInfo?.collection?.slug,
    args.documentInfo?.global?.slug,
  );
}

function findResolverBySlug(
  options: BuildLivePreviewUrlNullableOptions,
  collectionSlug: string | undefined,
  globalSlug: string | undefined,
): NullablePathResolver | undefined {
  if (
    collectionSlug !== undefined &&
    options.collections !== undefined &&
    Object.hasOwn(options.collections, collectionSlug)
  ) {
    return options.collections[collectionSlug];
  }
  if (
    globalSlug !== undefined &&
    options.globals !== undefined &&
    Object.hasOwn(options.globals, globalSlug)
  ) {
    return options.globals[globalSlug];
  }
  return undefined;
}

function normaliseLocale(locale: LivePreviewUrlArgs['locale']): string | undefined {
  if (locale === undefined) return undefined;
  if (typeof locale === 'string') return locale.length > 0 ? locale : undefined;
  return typeof locale.code === 'string' && locale.code.length > 0 ? locale.code : undefined;
}
