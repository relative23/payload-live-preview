/**
 * `withLivePreview(nextConfig)` — the parts of a Next.js setup that belong in
 * `next.config.ts` rather than in a layout: the admin's host in
 * `allowedDevOrigins`, so Next's dev server does not refuse the admin's own
 * server actions behind a proxy, and `private, no-store` on a request that
 * carries preview intent.
 *
 * What it cannot do is inject the script: no config hook renders HTML. That
 * stays one import and one spread in `app/layout.tsx` (docs/nextjs.md), so this
 * is a two-line setup, not a one-line one — said plainly rather than implied
 * away.
 *
 * **And it writes no CSP.** A config rule cannot run `authorizePreview`, so it
 * can never be the place a privileged response change is decided (ADR 0006 §5).
 * It could not even widen `frame-ancestors` safely: Next collects every
 * matching rule into one object keyed by header name and applies it with
 * `setHeader`, and these rules are appended after the consumer's, so a policy
 * written here replaces the one the site already sends instead of adding to
 * it. Measured on Next.js 16.3.4 (`next build` + `next start`): a site sending
 * `frame-ancestors 'none'` answered a bare `/?preview=true` with
 * `frame-ancestors 'self' <admin>` and nothing else — its `script-src` gone,
 * for anyone who appends the query parameter. `frame-ancestors` for the admin
 * origin is `createLivePreviewMiddleware`'s, which merges into an existing
 * policy and only once the engine has authorized the request.
 */

/** The slice of `next.config` this touches; everything else is passed through. */
export interface NextConfigLike {
  readonly allowedDevOrigins?: readonly string[];
  readonly headers?: () => Promise<readonly NextHeaderRule[]> | readonly NextHeaderRule[];
  readonly [option: string]: unknown;
}

export interface NextHeaderRule {
  readonly source: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
  readonly has?: readonly {
    readonly type: string;
    readonly key: string;
    readonly value?: string;
  }[];
  readonly [option: string]: unknown;
}

export interface WithLivePreviewOptions {
  /** Payload admin origins. Required; their hosts are what `allowedDevOrigins` needs. */
  readonly allowedOrigins: readonly string[];
  /**
   * Query parameters that mark preview intent, matching the runtime's own
   * defaults. The cache header is set only for requests carrying one of them.
   */
  readonly previewQueryParams?: readonly string[];
  /** Add the admin origins to `allowedDevOrigins`. Default `true`. */
  readonly allowDevOrigins?: boolean;
}

const DEFAULT_QUERY_PARAMS: readonly string[] = ['preview', 'draft', 'livePreview'];

function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

/** One rule per intent parameter: Next matches `has` entries as a conjunction. @internal */
export function previewHeaderRules(options: WithLivePreviewOptions): readonly NextHeaderRule[] {
  return (options.previewQueryParams ?? DEFAULT_QUERY_PARAMS).map((key) => ({
    source: '/:path*',
    has: [{ type: 'query', key, value: 'true' }],
    headers: [
      // A preview response is one visitor's unsaved state; a shared cache must
      // never keep it, and the same rule the adapters apply belongs here. It
      // restricts and grants nothing, which is why an unverified request may
      // set it where it may not set a CSP.
      { key: 'Cache-Control', value: 'private, no-store' },
    ],
  }));
}

/**
 * ```ts
 * // next.config.ts
 * export default withLivePreview(nextConfig, {
 *   allowedOrigins: [process.env.NEXT_PUBLIC_PAYLOAD_URL!],
 * });
 * ```
 */
export function withLivePreview(
  nextConfig: NextConfigLike,
  options: WithLivePreviewOptions,
): NextConfigLike {
  if (options.allowedOrigins.length === 0) {
    throw new Error(
      'payload-live-preview: withLivePreview() needs at least one admin origin in ' +
        '`allowedOrigins`; without one there is no host to add to `allowedDevOrigins` and the ' +
        'call would configure nothing.',
    );
  }
  const rules = previewHeaderRules(options);
  const existingHeaders = nextConfig.headers;
  const devOrigins =
    options.allowDevOrigins === false
      ? nextConfig.allowedDevOrigins
      : [
          ...(nextConfig.allowedDevOrigins ?? []),
          ...options.allowedOrigins
            .map(hostOf)
            .filter((host): host is string => host !== undefined),
        ];

  return {
    ...nextConfig,
    ...(devOrigins === undefined ? {} : { allowedDevOrigins: [...new Set(devOrigins)] }),
    headers: async () => [...(await (existingHeaders?.() ?? [])), ...rules],
  };
}
