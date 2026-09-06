/**
 * The runtime as a servable, cacheable asset — the request-time half of
 * `mode: 'loader'`.
 *
 * Name and integrity are constants of the package build (the artifact carries
 * both), so nothing here hashes anything per request and this module stays
 * reachable from a browser entry: no `node:crypto`, no Node builtins at all.
 *
 * The content hash is in the file name, which is what makes `immutable` honest:
 * different bytes are a different URL, so a year-long cache can never serve the
 * wrong runtime. A request for any other name under the mount path is a 404
 * rather than a redirect to the current one — a client asking for a hash we no
 * longer have is asking for bytes we cannot produce.
 */

import { RUNTIME_CONTENT_HASH, RUNTIME_INTEGRITY, RUNTIME_SOURCE } from '@inline/runtime.generated';
import type { RuntimeArtifact } from '@/types/inline-config';

/** Where the asset route is mounted when nothing says otherwise. */
export const DEFAULT_ASSET_PATH = '/payload-live-preview';

export interface RuntimeAssetOptions {
  /**
   * Path the asset route is mounted at. Must match on both sides — the
   * bootstrap requests it and the route serves it. Default
   * `/payload-live-preview`; give it the framework's own base path as a prefix
   * when the app is not served from the site root.
   */
  readonly assetPath?: string;
  /** The artifact to serve; the default runtime when omitted. */
  readonly runtime?: RuntimeArtifact;
}

export interface RuntimeAsset {
  /** The file name alone, `runtime.<hash>.js`. */
  readonly fileName: string;
  /** The absolute path the bootstrap requests, mount path included. */
  readonly urlPath: string;
  /** `sha384-…`, for the bootstrap's `integrity` attribute. */
  readonly integrity: string;
  /** The bytes to serve. */
  readonly source: string;
}

/** One leading slash, no trailing one, so joining is a single concatenation. */
function normalizePath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/gu, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}

/** Describe the asset for these options; deterministic per package version and artifact. */
export function runtimeAsset(options: RuntimeAssetOptions = {}): RuntimeAsset {
  const artifact = options.runtime;
  const hash = artifact?.contentHash ?? RUNTIME_CONTENT_HASH;
  const fileName = `runtime.${hash}.js`;
  return {
    fileName,
    urlPath: `${normalizePath(options.assetPath ?? DEFAULT_ASSET_PATH)}/${fileName}`,
    integrity: artifact?.integrity ?? RUNTIME_INTEGRITY,
    source: artifact?.source ?? RUNTIME_SOURCE,
  };
}

/**
 * A year, the longest `max-age` browsers honour, plus `immutable` so a reload
 * does not revalidate either. Safe only because the hash is in the name.
 */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The headers the asset is served with, on every framework. */
export function runtimeAssetHeaders(): Record<string, string> {
  return {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': ASSET_CACHE_CONTROL,
    // The bootstrap sets `crossorigin="anonymous"` for the integrity check;
    // same-origin needs no CORS header, and a CDN in front of it gets one that
    // says the bytes are public.
    'access-control-allow-origin': '*',
    // Nothing here is HTML, and a browser that sniffs it as such would be wrong.
    'x-content-type-options': 'nosniff',
  };
}

/**
 * The response for one requested URL: the asset when the file name is the one
 * this build produces, 404 otherwise.
 *
 * Only the file name is checked, never the mount path. Where the route sits is
 * the framework's business — the consumer put the file there — while the name
 * is ours, and it is the name that decides whether the bytes a client cached
 * for a year are still the bytes we would send.
 */
export function runtimeAssetResponse(url: string, options: RuntimeAssetOptions = {}): Response {
  const asset = runtimeAsset(options);
  // A query string is a cache-buster and must still resolve.
  const path = url.split('?')[0] ?? '';
  const requested = path.slice(path.lastIndexOf('/') + 1);
  if (requested !== asset.fileName) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(asset.source, { status: 200, headers: runtimeAssetHeaders() });
}
