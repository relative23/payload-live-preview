/**
 * The runtime as a servable, cacheable asset. Name and integrity are constants
 * of the package build, so nothing here needs `node:crypto` — this module is
 * reachable from a browser entry.
 */
import { RUNTIME_CONTENT_HASH, RUNTIME_INTEGRITY, RUNTIME_SOURCE } from '@inline/runtime.generated';

// Not `_astro/`: Astro's bundler empties and rewrites that directory.
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

/** Describe the asset for this build; deterministic per package version. */
export function loaderAsset(base = '/'): LoaderAsset {
  const fileName = `${ASSET_DIR}/runtime.${RUNTIME_CONTENT_HASH}.js`;
  // `base` may carry slashes at either end; normalise to exactly one between segments.
  const prefix = `/${base.replace(/^\/+|\/+$/gu, '')}`;
  return {
    fileName,
    urlPath: prefix === '/' ? `/${fileName}` : `${prefix}/${fileName}`,
    integrity: RUNTIME_INTEGRITY,
    source: RUNTIME_SOURCE,
  };
}
