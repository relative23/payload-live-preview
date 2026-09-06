/**
 * The runtime as a servable, cacheable asset, in the shape Astro's build wants:
 * a path inside the output directory to emit, and a site path to request.
 *
 * The naming and the digests come from `runtimeAsset()`, the same descriptor
 * the route-serving adapters use, so there is one answer to "what is this file
 * called" across all four. What stays Astro's own is the directory: an
 * underscore keeps it out of Astro's page routing, which is exactly what the
 * others cannot use — a leading underscore makes a folder private in the App
 * Router and in SvelteKit both.
 */
import { runtimeAsset } from '@adapters/shared/runtime-asset';
import type { RuntimeArtifact } from '@/types/inline-config';

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

/** Describe the asset for this build; deterministic per package version and artifact. */
export function loaderAsset(base = '/', runtime?: RuntimeArtifact): LoaderAsset {
  // `base` may carry slashes at either end; normalise to exactly one between segments.
  const prefix = base.replace(/^\/+|\/+$/gu, '');
  const asset = runtimeAsset({
    assetPath: prefix === '' ? `/${ASSET_DIR}` : `/${prefix}/${ASSET_DIR}`,
    ...(runtime !== undefined ? { runtime } : {}),
  });
  return {
    fileName: `${ASSET_DIR}/${asset.fileName}`,
    urlPath: asset.urlPath,
    integrity: asset.integrity,
    source: asset.source,
  };
}
