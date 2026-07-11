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
 * import { buildLivePreviewUrl } from '@relative23/payload-live-preview/payload';
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
   * Query parameter appended so the frontend can recognise the request
   * as a preview (`isPreviewRequest` checks it). Set `null` to disable.
   * Default `'preview'` → `?preview=true`.
   */
  readonly previewParam?: string | null;
}

/**
 * Build an `admin.livePreview.url` callback from declarative slug →
 * path mappings.
 */
export function buildLivePreviewUrl(
  options: BuildLivePreviewUrlOptions,
): (args: LivePreviewUrlArgs) => string {
  const base = options.baseUrl.replace(/\/+$/, '');
  const fallback = options.fallback ?? '/';
  const previewParam = options.previewParam === undefined ? 'preview' : options.previewParam;

  return (args) => {
    const locale = normaliseLocale(args.locale);
    const context: PathResolverContext = { data: args.data, locale };

    const resolver =
      (args.collectionConfig !== undefined
        ? options.collections?.[args.collectionConfig.slug]
        : undefined) ??
      (args.globalConfig !== undefined ? options.globals?.[args.globalConfig.slug] : undefined);

    let path = fallback;
    if (resolver !== undefined) {
      const resolved = typeof resolver === 'function' ? resolver(context) : resolver;
      if (resolved.length > 0) path = resolved;
    }
    if (!path.startsWith('/')) path = `/${path}`;

    if (previewParam === null) return `${base}${path}`;
    const separator = path.includes('?') ? '&' : '?';
    return `${base}${path}${separator}${previewParam}=true`;
  };
}

function normaliseLocale(locale: LivePreviewUrlArgs['locale']): string | undefined {
  if (locale === undefined) return undefined;
  if (typeof locale === 'string') return locale.length > 0 ? locale : undefined;
  return locale.code.length > 0 ? locale.code : undefined;
}
