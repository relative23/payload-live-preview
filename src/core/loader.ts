/**
 * Static-delivery bootstrap: on a statically built site nothing can decide per
 * request, so ordinary visitors get these few hundred bytes and only a real
 * preview fetches the runtime as a content-hashed asset. It reuses the
 * runtime's own `isInPreviewContext()` rather than restating it, because a
 * second copy would drift into a preview that silently never starts.
 */
import { isInPreviewContext } from '@detection/environment';

// Declared, never defined: the generator prepends the `var`s. As build-time
// constants the minifier folds the integrity branch away and every page ships
// `integrity=""`, which browsers treat as a failing check.
declare const __LP_RUNTIME_SRC__: string;
declare const __LP_RUNTIME_INTEGRITY__: string;

/**
 * `crossorigin="anonymous"` is what makes `integrity` enforceable cross-origin.
 * A failure is not retried: a mismatched asset is not the one this page was
 * built against, and loading it anyway is the wrong recovery.
 */
function loadRuntime(): void {
  const script = document.createElement('script');
  script.src = __LP_RUNTIME_SRC__;
  if (__LP_RUNTIME_INTEGRITY__ !== '') {
    script.integrity = __LP_RUNTIME_INTEGRITY__;
    script.crossOrigin = 'anonymous';
  }
  // The platform default for a created script, stated so a reader need not recall it.
  script.async = true;
  document.head.appendChild(script);
}

if (isInPreviewContext()) {
  loadRuntime();
}
