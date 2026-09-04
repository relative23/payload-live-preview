/**
 * `payload-live-preview/payload` — helpers for `payload.config.ts`. It never
 * imports `payload`, only produces the callback `admin.livePreview.url` expects.
 */

/** Arguments Payload passes to `admin.livePreview.url`. */
export interface LivePreviewUrlArgs {
  readonly data: Record<string, unknown>;
  readonly locale?: string | { readonly code: string };
  readonly collectionConfig?: { readonly slug: string };
  readonly globalConfig?: { readonly slug: string };
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
  /** Query parameter signalling preview intent; client-controlled, so it authorizes nothing. Default `'preview'`, `null` disables it. */
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
  if (new URLSearchParams(query).get(name) === 'true') return path;
  const separator = queryAt === -1 ? '?' : query.length === 0 || query.endsWith('&') ? '' : '&';
  return `${beforeHash}${separator}${name}=true${hash}`;
}

/** The mapped resolver, or `undefined` when the slug is not mapped; a mapped `null` is a resolver in its own right. */
function findResolver(
  options: BuildLivePreviewUrlNullableOptions,
  args: LivePreviewUrlArgs,
): NullablePathResolver | undefined {
  const collectionSlug = args.collectionConfig?.slug;
  if (
    collectionSlug !== undefined &&
    options.collections !== undefined &&
    Object.hasOwn(options.collections, collectionSlug)
  ) {
    return options.collections[collectionSlug];
  }
  const globalSlug = args.globalConfig?.slug;
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
  return locale.code.length > 0 ? locale.code : undefined;
}
