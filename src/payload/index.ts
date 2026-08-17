/**
 * Backend-side helpers for `payload.config.ts`.
 *
 * Payload's `admin.livePreview.url` callback maps the document being
 * edited to the frontend URL that should be shown in the preview
 * iframe. In practice every project hand-writes the same lookup-table
 * boilerplate (global → path, collection → localized route, fallback
 * when a new draft has no slug yet). `buildLivePreviewUrl` packages
 * that pattern.
 *
 * This module is dependency-free and framework-agnostic — it does not
 * import `payload`, it just produces a function with the documented
 * callback shape.
 *
 * ```ts
 * // payload.config.ts
 * import { buildLivePreviewUrl } from 'payload-live-preview/payload';
 *
 * admin: {
 *   livePreview: {
 *     url: buildLivePreviewUrl({
 *       baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
 *       collections: {
 *         services: ({ data, locale }) => `/${locale}/services/${String(data.slug ?? '')}`,
 *         posts: ({ data }) => `/blog/${String(data.slug ?? '')}`,
 *       },
 *       globals: {
 *         homepage: '/',
 *         contact: ({ locale }) => `/${locale}/contact`,
 *       },
 *       fallback: '/',
 *     }),
 *     collections: ['services', 'posts'],
 *     globals: ['homepage', 'contact'],
 *   },
 * }
 * ```
 *
 * @module @payload
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
  /** Normalised locale code (string), or `undefined`. */
  readonly locale: string | undefined;
}

export type PathResolver = string | ((context: PathResolverContext) => string);

/**
 * Path resolver that may decline a document entirely.
 *
 * `null` means "this document has no preview target" — Payload then shows no
 * preview iframe. An empty string keeps its 1.x meaning and falls back.
 */
export type NullablePathResolver =
  string | null | ((context: PathResolverContext) => string | null);

export interface BuildLivePreviewUrlOptions {
  /** Frontend origin, e.g. `https://site.example` (no trailing slash needed). */
  readonly baseUrl: string;
  /** Per-collection path resolvers keyed by collection slug. */
  readonly collections?: Readonly<Record<string, PathResolver>>;
  /** Per-global path resolvers keyed by global slug. */
  readonly globals?: Readonly<Record<string, PathResolver>>;
  /**
   * Path used when no resolver matches, or when a resolver returns an
   * empty string (e.g. a brand-new draft without a slug). Default `/`.
   */
  readonly fallback?: string;
  /**
   * Query parameter appended so the frontend can detect preview intent
   * (`isPreviewRequest` checks it). This client-controlled signal does
   * not authenticate or authorize draft access or response changes.
   * Set `null` to disable. Default `'preview'` → `?preview=true`.
   */
  readonly previewParam?: string | null;
}

/**
 * Options that let a document have no preview target at all.
 *
 * Identical to {@link BuildLivePreviewUrlOptions} except that resolvers and
 * `fallback` accept `null`. Using any of them widens the built callback's
 * return type to `string | null`, which is what Payload's own `url` callback
 * accepts — a document without a reachable route should show no iframe rather
 * than silently point at a public page.
 */
export interface BuildLivePreviewUrlNullableOptions {
  /** Frontend origin, e.g. `https://site.example` (no trailing slash needed). */
  readonly baseUrl: string;
  /** Per-collection path resolvers keyed by collection slug. */
  readonly collections?: Readonly<Record<string, NullablePathResolver>>;
  /** Per-global path resolvers keyed by global slug. */
  readonly globals?: Readonly<Record<string, NullablePathResolver>>;
  /**
   * Path used when no resolver matches, or when a resolver returns an empty
   * string. `null` declines every unmapped document instead of sending it to
   * a default route. Default `/`.
   */
  readonly fallback?: string | null;
  /** See {@link BuildLivePreviewUrlOptions.previewParam}. */
  readonly previewParam?: string | null;
}

/**
 * Build an `admin.livePreview.url` callback from declarative slug →
 * path mappings.
 *
 * With string-only resolvers the callback always produces a URL, exactly as
 * in 1.0. Let a resolver or `fallback` return `null` and the callback becomes
 * nullable, so a document with no reachable route resolves to no preview
 * instead of to a default public page.
 */
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
  // `??` would swallow an explicit `null`, which is the whole point of the
  // nullable form: only an absent option falls back to the default path.
  const fallback = options.fallback === undefined ? '/' : options.fallback;
  const previewParam = options.previewParam === undefined ? 'preview' : options.previewParam;

  return (args) => {
    const locale = normaliseLocale(args.locale);
    const context: PathResolverContext = { data: args.data, locale };

    // A registered resolver whose value is `null` must not be mistaken for an
    // absent one, so presence is tested rather than coalesced.
    const entry = findResolver(options, args);

    let path: string | null = fallback;
    if (entry !== undefined) {
      const resolved = typeof entry === 'function' ? entry(context) : entry;
      // `null` is the resolver declining the document; an empty string keeps
      // its 1.x meaning and falls back.
      if (resolved === null) return null;
      if (resolved.length > 0) path = resolved;
    }
    if (path === null) return null;
    if (!path.startsWith('/')) path = `/${path}`;

    if (previewParam === null) return `${base}${path}`;
    const separator = path.includes('?') ? '&' : '?';
    return `${base}${path}${separator}${previewParam}=true`;
  };
}

/**
 * Registered resolver for this document, or `undefined` when the slug is not
 * mapped at all. A mapped-but-`null` entry returns `null`, which is a resolver
 * value in its own right.
 */
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
