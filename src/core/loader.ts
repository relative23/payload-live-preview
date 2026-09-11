/**
 * Static-delivery bootstrap: on a statically built site nothing can decide per
 * request, so ordinary visitors get these few hundred bytes and only a real
 * preview fetches the runtime as a content-hashed asset. It reuses the
 * runtime's own `isInPreviewContext()` rather than restating it, because a
 * second copy would drift into a preview that silently never starts.
 */
import { isInPreviewContext } from '@detection/environment';
import { armReactCommitSignal } from './hydration';

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

// The bootstrap for a page that declares React hydration (ADR 0015) arms the
// commit signal before it fetches: the runtime is a fetched asset that may
// evaluate after `react-dom` has, when it is too late to be injected into,
// while this script is in `<head>` and is not. Built twice from this file —
// the define folds the arming out of the plain bootstrap, hook and all — so a
// static page keeps its floor and a React page gets one script, not a prelude.
if (typeof __REACT_BOOTSTRAP__ !== 'undefined' && __REACT_BOOTSTRAP__) armReactCommitSignal();

if (isInPreviewContext()) {
  loadRuntime();
}
