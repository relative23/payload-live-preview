/**
 * `withLivePreview(nextConfig)` — the parts of a Next.js setup that belong in
 * `next.config.ts` rather than in a layout.
 *
 * Two things a preview needs and a config can give it: the admin's origin in
 * `frame-ancestors`, so the panel may frame the page at all, and that origin in
 * `allowedDevOrigins`, so Next's dev server does not refuse the admin's own
 * server actions behind a proxy. Both are pure configuration, and both are easy
 * to forget until a preview shows a blank frame.
 *
 * What it cannot do is inject the script: no config hook renders HTML. That
 * stays one import and one spread in `app/layout.tsx` (docs/nextjs.md), so this
 * is a two-line setup, not a one-line one — said plainly rather than implied
 * away.
 *
 * The CSP here is narrow on purpose: it applies only to requests carrying
 * preview intent, and it never replaces a policy you already send. A site with
 * its own CSP should keep using `createLivePreviewMiddleware`, which merges
 * `frame-ancestors` into the existing header instead of adding a second one.
 */

import { buildFrameAncestors } from '@security/csp';

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
  /** Payload admin origins allowed to frame the preview. Required: an empty policy frames nothing. */
  readonly allowedOrigins: readonly string[];
  /**
   * Query parameters that mark preview intent, matching the runtime's own
   * defaults. The CSP is added only for requests carrying one of them.
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
  const frameAncestors = buildFrameAncestors({ origins: options.allowedOrigins });
  return (options.previewQueryParams ?? DEFAULT_QUERY_PARAMS).map((key) => ({
    source: '/:path*',
    has: [{ type: 'query', key, value: 'true' }],
    headers: [
      { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` },
      // A preview response is one visitor's unsaved state; a shared cache must
      // never keep it, and the same rule the adapters apply belongs here.
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
        '`allowedOrigins`; without one the frame-ancestors policy would allow nothing and the ' +
        'admin could not frame the page.',
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
