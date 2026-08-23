/**
 * Static-delivery bootstrap: decide whether this page needs the runtime at all.
 *
 * A statically built site has no server to decide per request, so `mode:
 * 'inline'` bakes the whole runtime — currently around 21 KB gzip — into every
 * page. Ordinary visitors pay that in transfer and parse for a feature only an
 * editor inside the admin iframe will ever use.
 *
 * This bootstrap is what those visitors get instead. It runs the same
 * `isInPreviewContext()` the runtime would have run, and only when that says
 * yes does it fetch the runtime as an external, content-hashed asset. Sharing
 * the detection rather than restating it is the point: a second copy would
 * drift, and the failure mode of drift here is a preview that silently never
 * starts.
 *
 * The runtime asset itself is configuration-free. The bootstrap assigns
 * `__LIVE_PREVIEW_CONFIG__` before appending the script, so the asset is byte
 * identical for every site that uses this version — cacheable across pages and
 * across deployments, and incapable of carrying a token by construction.
 *
 * @module @core/loader
 */
import { isInPreviewContext } from '@detection/environment';

// Declared, never defined at build time. esbuild keeps these as identifier
// reads and the generator prepends the `var` declarations, exactly as it does
// for `__LIVE_PREVIEW_CONFIG__`. Substituting them as build-time constants
// instead would let the minifier fold the integrity check away: the
// placeholder is always truthy, so the branch collapsed and every page got
// `integrity=""` — which a browser treats as a malformed, failing check.
declare const __LP_RUNTIME_SRC__: string;
declare const __LP_RUNTIME_INTEGRITY__: string;

/**
 * Append the runtime script.
 *
 * `crossorigin="anonymous"` is required for `integrity` to be enforced on a
 * cross-origin fetch, and harmless same-origin. Failure is deliberately not
 * retried: an integrity mismatch means the asset is not the one this page was
 * built against, and loading it anyway is the wrong recovery.
 */
function loadRuntime(): void {
  const script = document.createElement('script');
  script.src = __LP_RUNTIME_SRC__;
  if (__LP_RUNTIME_INTEGRITY__ !== '') {
    script.integrity = __LP_RUNTIME_INTEGRITY__;
    script.crossOrigin = 'anonymous';
  }
  script.async = true;
  document.head.appendChild(script);
}

if (isInPreviewContext()) {
  loadRuntime();
}
