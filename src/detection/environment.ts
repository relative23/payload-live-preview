/**
 * Environment introspection helpers.
 *
 * The detection layer needs to know whether the runtime is currently
 * running inside an iframe, in a popup, in development mode, and
 * whether environment variables are accessible. None of these checks
 * is dramatic on its own, but having a single, tested module avoids
 * the duplicated, subtly-different `typeof process` snippets that
 * accumulated in the legacy implementation.
 *
 * @module @detection/environment
 */

/**
 * Returns `true` when the current window is inside an iframe.
 *
 * Uses a try/catch around `window.self !== window.top` because the
 * comparison throws in cross-origin iframes — and that very throw is
 * itself a definitive "yes, I am in an iframe" signal.
 */
export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Returns `true` when the current window was opened via `window.open()`
 * and the opener reference is still accessible.
 */
export function isInPopup(): boolean {
  if (typeof window === 'undefined') return false;
  return window.opener != null;
}

/**
 * Returns `true` when running in a preview-capable context: iframe or
 * popup. Anything else (top-level navigation) should skip live preview
 * initialisation entirely.
 */
export function isInPreviewContext(): boolean {
  return isInIframe() || isInPopup();
}

/**
 * Returns `true` when the runtime appears to be in development mode.
 *
 * Detection order:
 *   1. `process.env.NODE_ENV !== 'production'`
 *   2. `import.meta.env.DEV === true` (Vite / Astro / SvelteKit)
 *   3. `window.location.hostname` is `localhost`/`127.0.0.1`
 *
 * Returns `false` when none of those are available.
 */
export function isDevMode(): boolean {
  const nodeEnv = readNodeEnv();
  if (nodeEnv !== undefined) return nodeEnv !== 'production';
  const importMetaDev = readImportMetaDev();
  if (importMetaDev !== undefined) return importMetaDev;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  }
  return false;
}

/**
 * Read a named environment variable from whichever runtime exposes it.
 *
 * The variable is first looked up via `process.env`, then via Vite's
 * `import.meta.env`. Returns `undefined` when neither has a value.
 */
export function getEnvVar(name: string): string | undefined {
  if (typeof process !== 'undefined') {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const meta = tryReadImportMetaEnv();
  if (meta) {
    const value = meta[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function readNodeEnv(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const value = process.env['NODE_ENV'];
  return typeof value === 'string' ? value : undefined;
}

function readImportMetaDev(): boolean | undefined {
  const meta = tryReadImportMetaEnv();
  if (!meta) return undefined;
  const dev = meta['DEV'];
  return typeof dev === 'boolean' ? dev : undefined;
}

/**
 * Compile-time flag injected by `scripts/build-runtime.ts`. Inside the
 * inline IIFE `import.meta` can never exist (classic scripts have no
 * module meta, and no bundler rewrites the inline tag), so the probe
 * below is statically disabled there — probing would run `new
 * Function`, which pages with a strict `script-src` (no
 * `unsafe-eval`) report as a CSP violation on every load.
 */
declare const __INLINE_RUNTIME_BUILD__: boolean | undefined;

let importMetaEnvCache: Record<string, unknown> | null | undefined;

/**
 * Safely read `import.meta.env` without throwing in runtimes that do
 * not support `import.meta`. Returns `undefined` when unavailable.
 *
 * The indirection through `Function('return import.meta...')` is
 * intentional: parsing `import.meta` in CJS bundles fails at parse
 * time. By wrapping it in `Function`, the parse happens lazily and
 * crashes are caught at call time. The result is memoised so the
 * probe (an eval in CSP terms) runs at most once per page.
 */
function tryReadImportMetaEnv(): Record<string, unknown> | undefined {
  if (typeof __INLINE_RUNTIME_BUILD__ !== 'undefined' && __INLINE_RUNTIME_BUILD__) {
    return undefined;
  }
  if (importMetaEnvCache !== undefined) return importMetaEnvCache ?? undefined;
  importMetaEnvCache = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional lazy parse
    const reader = new Function(
      'try { return import.meta && import.meta.env; } catch (_) { return undefined; }',
    ) as () => unknown;
    const result = reader();
    if (result && typeof result === 'object') {
      importMetaEnvCache = result as Record<string, unknown>;
      return importMetaEnvCache;
    }
  } catch {
    // ignore
  }
  return undefined;
}
