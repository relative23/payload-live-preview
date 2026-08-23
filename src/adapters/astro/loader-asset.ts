/**
 * The runtime as a servable, cacheable asset.
 *
 * Static delivery needs the bootstrap to know the asset's final URL and its
 * integrity *before* it is injected, which normally fights the build order:
 * names are hashed during the bundle, injection happens at config time.
 *
 * It does not fight here, because the asset is configuration-free. Its content
 * is `RUNTIME_SOURCE` — a constant of this package version — so its hash and
 * integrity are computed once when the package itself is built and shipped as
 * constants. Nothing waits for the bundler, and nothing here needs
 * `node:crypto`: this module is reachable from a browser entry, where the
 * architecture policy rightly refuses Node builtins.
 *
 * @module @adapters/astro/loader-asset
 */
import { RUNTIME_CONTENT_HASH, RUNTIME_INTEGRITY, RUNTIME_SOURCE } from '@inline/runtime.generated';

/**
 * Directory the asset is published under.
 *
 * Deliberately not `_astro/`: that directory belongs to Astro's own bundler and
 * is emptied and rewritten by it. A dedicated prefix keeps this file out of
 * the way of a tool that assumes it owns everything in there.
 */
const ASSET_DIR = '_payload-live-preview';

export interface LoaderAsset {
  /** Path within the build output, e.g. `_payload-live-preview/runtime.<hash>.js`. */
  readonly fileName: string;
  /** Absolute site path the bootstrap requests, with a leading slash. */
  readonly urlPath: string;
  /** `sha384-…`, for the bootstrap's `integrity` attribute. */
  readonly integrity: string;
  /** The bytes to write or serve. */
  readonly source: string;
}

/**
 * Describe the asset for this build.
 *
 * Pure and deterministic: the same package version always produces the same
 * name, so a redeploy that did not change the runtime does not invalidate the
 * cached file.
 */
export function loaderAsset(base = '/'): LoaderAsset {
  const fileName = `${ASSET_DIR}/runtime.${RUNTIME_CONTENT_HASH}.js`;
  // Astro's `base` may or may not carry slashes at either end; normalise both
  // so the result is always exactly one slash between segments.
  const prefix = `/${base.replace(/^\/+|\/+$/gu, '')}`;
  return {
    fileName,
    urlPath: prefix === '/' ? `/${fileName}` : `${prefix}/${fileName}`,
    integrity: RUNTIME_INTEGRITY,
    source: RUNTIME_SOURCE,
  };
}
