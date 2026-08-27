/**
 * Inline runtime entry point.
 *
 * This file is the *single source of truth* for the JavaScript that
 * gets injected into preview pages. `scripts/build-runtime.ts` bundles
 * this entry into an IIFE and bakes the minified output into
 * `src/inline/runtime.generated.ts`. The high-level client uses the
 * same module via direct import.
 *
 * Both paths share:
 *   - `LivePreviewRuntime` (lifecycle orchestration)
 *   - `OriginDetector` (handshake-aware origin matcher)
 *   - The complete security stack from `@security`
 *
 * Differences live exclusively in the *wiring*:
 *   - The inline runtime auto-starts and exposes `window.__livePreview`.
 *   - The high-level client gives consumers programmatic control.
 *
 * @module @core/runtime
 */

import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from './lifecycle';
import { OriginDetector } from '@detection/origin';
import { setSanitizerPolicy } from '@security/sanitizer';
import { isInPreviewContext, isInIframe, isInPopup } from '@detection/environment';
import { bindNavigationLifecycle } from './navigation-lifecycle';
import { VERSION } from '../version';
import type { LivePreviewInspection } from './inspection/types';
import type { FieldRenderer } from './types';
import { safeConsoleDebug, safeConsoleWarn } from './diagnostics';

/**
 * Build-time configuration baked into the inline IIFE.
 *
 * Defaults come from `scripts/build-runtime.ts` and `inline/generator.ts`.
 * Consumers override them through `generateInlineScript()` options.
 */
/** Compact private wire format shared only with `src/inline/generator.ts`. */
type RuntimeBuildConfig = readonly [
  additionalOrigins?: readonly string[],
  serverURL?: string,
  apiRoute?: string,
  mergeDepth?: number,
  debug?: boolean,
  debounceMs?: number,
  enableA11y?: boolean,
  heartbeatMs?: number,
  disableVisibilityGate?: boolean,
  visibilityGateThreshold?: number,
  intersectionRootMargin?: string,
  disableReferrerDetection?: boolean,
  disableLocalhostMatching?: boolean,
  scopeBindingsByOwner?: boolean,
  skipUnchanged?: boolean,
  eventSourcePolicy?: 'any' | 'parent-or-opener',
  sanitizerPolicy?: 'compat' | 'strict',
];

declare const __LIVE_PREVIEW_CONFIG__: RuntimeBuildConfig;

/**
 * Field renderers built into the inline runtime.
 *
 * `buildBuiltinRenderers` from the field-types barrel returns the
 * frozen renderer map after assembling every concrete renderer via
 * explicit named imports — robust against `sideEffects: false`.
 */
import { buildBuiltinRenderers } from '@field-types/index';

/**
 * Public global API exposed on `window.__livePreview` by the inline
 * runtime. The shape is deliberately small — anything more sophisticated
 * belongs in the high-level client.
 */
export interface LivePreviewGlobalApi {
  readonly destroy: () => void;
  readonly refresh: () => void;
  readonly enumerateOrigins: () => readonly string[];
  /**
   * Point-in-time read of runtime state, for diagnosing a preview that is not
   * updating. Reachable from the browser console as
   * `__livePreview.inspect()`, which is the point: an adapter user has no
   * client object to call a method on, and the failures worth diagnosing
   * happen on a deployed page rather than in a test.
   */
  readonly inspect: () => LivePreviewInspection;
  readonly version: string;
}

/**
 * Bootstrap the inline runtime. The function bails out (returning
 * `undefined`) when the current window is not a preview context. That
 * is intentional: top-level navigation should never instantiate the
 * preview, even if the script tag accidentally loads there.
 */
export function bootstrapInlineRuntime(): LivePreviewGlobalApi | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!isInPreviewContext()) return undefined;

  // Double-injection guard: when the script is embedded twice (e.g. the
  // Astro integration AND the middleware both inject it), the first
  // instance wins and the second becomes a no-op.
  const existing = (window as { __livePreview?: LivePreviewGlobalApi }).__livePreview;
  if (existing !== undefined) return existing;

  const [
    additionalOrigins = [],
    serverURL = '',
    apiRoute = '/api',
    mergeDepth = 1,
    debug = false,
    debounceMs = 50,
    enableA11y = true,
    heartbeatMs = 0,
    disableVisibilityGate = false,
    visibilityGateThreshold = 50,
    intersectionRootMargin = '200px',
    disableReferrerDetection = false,
    disableLocalhostMatching = false,
    scopeBindingsByOwner = false,
    skipUnchanged = false,
    eventSourcePolicy = 'any',
    sanitizerPolicy = 'compat',
  ] = readBuildConfig();
  setSanitizerPolicy(sanitizerPolicy);

  const detector = new OriginDetector({
    additionalOrigins,
    enableReferrerDetection: !disableReferrerDetection,
    enableLocalhostMatching: !disableLocalhostMatching,
  });

  if (detector.isProductionUnconfigured) {
    safeConsoleWarn(
      '[live-preview] LP0101: No trusted origin. Set PAYLOAD_ADMIN_ORIGIN or pass allowedOrigins to generateInlineScript().',
    );
  } else if (detector.isReferrerOnlyTrust) {
    safeConsoleWarn(
      '[live-preview] LP0102: document.referrer fallback trusts any framing site. ' +
        'Set allowedOrigins and a frame-ancestors CSP in production.',
    );
  }

  const emitter = new EventEmitter();
  const renderers: Readonly<Record<string, FieldRenderer>> = buildBuiltinRenderers();

  const runtime = new LivePreviewRuntime({
    renderers,
    originMatcher: (origin) => detector.matches(origin),
    lockedOrigin: () => detector.lockedOrigin,
    readyTargets: detector.enumerate(),
    emitter,
    eventSourcePolicy,
    // Guard on typeof — a config literal baked by an older generator
    // (or a hand-written one in tests) may not carry the merge fields.
    ...(serverURL !== ''
      ? {
          dataMerge: {
            serverURL,
            apiRoute,
            depth: mergeDepth,
          },
        }
      : {}),
    debounceMs,
    heartbeatMs,
    intersectionRootMargin,
    disableVisibilityGate,
    visibilityGateThreshold,
    enableA11y,
    scopeBindingsByOwner,
    skipUnchanged,
    onHeartbeatTimeout: () => {
      detector.unlockOrigin();
    },
    ...(debug
      ? {
          log: (...args: unknown[]): void => {
            safeConsoleDebug('[live-preview]', ...args);
          },
        }
      : {}),
  });

  // On the first accepted data-bearing update, `connect` locks the detector
  // to that origin so every subsequent message must match it exactly.
  emitter.on('connect', (e) => {
    detector.lockOrigin(e.origin);
  });

  runtime.start();

  // Own the document lifecycle here rather than leaving it to each adapter.
  // A back/forward-cache restore does not re-run this script, so without it an
  // inline runtime returns bound to a document the browser froze and thawed and
  // silently stops updating. Every adapter injects this entry, so binding it
  // here is what makes the behaviour reachable at all — the programmatic client
  // exposes `bindNavigationLifecycle` for consumers that start it themselves.
  //
  // Soft navigation is deliberately not bound: only the host knows which event
  // its router fires, and guessing would rebuild the cache on the wrong one.
  const unbindLifecycle = bindNavigationLifecycle({
    suspend: () => runtime.suspend(),
    resume: () => runtime.start(),
    refreshCache: () => {
      runtime.refreshCache();
    },
  });

  const api: LivePreviewGlobalApi = Object.freeze({
    version: VERSION,
    destroy: () => {
      unbindLifecycle();
      runtime.destroy();
      // Clear the global handle so a later bootstrap starts a fresh
      // runtime instead of returning this now-dead API. The property is
      // defined `configurable: true` precisely so it can be removed here.
      const w = window as { __livePreview?: LivePreviewGlobalApi };
      if (w.__livePreview === api) delete w.__livePreview;
    },
    refresh: () => {
      runtime.refreshCache();
    },
    enumerateOrigins: () => detector.enumerate(),
    inspect: () => runtime.inspect(),
  });

  try {
    Object.defineProperty(window, '__livePreview', {
      value: api,
      writable: false,
      configurable: true,
    });
  } catch (error) {
    // Starting the runtime and publishing its owner handle are one bootstrap
    // transaction. A hostile/pre-existing global descriptor must not leave an
    // unreachable runtime listening, observing, or retrying in the background.
    unbindLifecycle();
    runtime.destroy();
    throw error;
  }

  return api;
}

function readBuildConfig(): RuntimeBuildConfig {
  return typeof __LIVE_PREVIEW_CONFIG__ === 'undefined' ? [] : __LIVE_PREVIEW_CONFIG__;
}

// Auto-start when this module is executed as the inline IIFE.
// The build step ensures this entry is the IIFE root; the high-level
// client imports `bootstrapInlineRuntime` directly and calls it
// explicitly.
declare const __INLINE_BUILD__: boolean | undefined;
const inlineBuild: boolean = typeof __INLINE_BUILD__ === 'undefined' ? false : __INLINE_BUILD__;
if (inlineBuild) {
  void bootstrapInlineRuntime();
}

export const __RUNTIME_HELPERS_FOR_TESTS = {
  isInIframe,
  isInPopup,
  isInPreviewContext,
};
