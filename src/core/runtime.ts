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
import { isInPreviewContext, isInIframe, isInPopup } from '@detection/environment';
import { VERSION } from '../version';
import type { FieldRenderer } from './types';

/**
 * Build-time configuration baked into the inline IIFE.
 *
 * Defaults come from `scripts/build-runtime.ts` and `inline/generator.ts`.
 * Consumers override them through `generateInlineScript()` options.
 */
declare const __LIVE_PREVIEW_CONFIG__: {
  readonly additionalOrigins: readonly string[];
  readonly serverURL: string;
  readonly apiRoute: string;
  readonly mergeDepth: number;
  readonly debug: boolean;
  readonly debounceMs: number;
  readonly enableA11y: boolean;
  readonly heartbeatMs: number;
  readonly disableVisibilityGate: boolean;
  readonly visibilityGateThreshold: number;
  readonly intersectionRootMargin: string;
  readonly disableReferrerDetection: boolean;
  readonly disableLocalhostMatching: boolean;
};

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

  const config = readBuildConfig();

  const detector = new OriginDetector({
    additionalOrigins: config.additionalOrigins,
    enableReferrerDetection: !config.disableReferrerDetection,
    enableLocalhostMatching: !config.disableLocalhostMatching,
  });

  if (detector.isProductionUnconfigured) {
    console.warn(
      '[live-preview] No trusted origin could be detected. ' +
        'Set the PAYLOAD_ADMIN_ORIGIN env var or pass `allowedOrigins` to generateInlineScript().',
    );
  } else if (detector.isReferrerOnlyTrust) {
    console.warn(
      '[live-preview] Trusting the embedding page via document.referrer only — any site ' +
        'that frames this page could post preview updates. Pass explicit `allowedOrigins` ' +
        'and serve a `frame-ancestors` CSP for production.',
    );
  }

  const emitter = new EventEmitter();
  const renderers: Readonly<Record<string, FieldRenderer>> = buildBuiltinRenderers();

  const runtime = new LivePreviewRuntime({
    renderers,
    originMatcher: (origin) => detector.matches(origin),
    readyTargets: detector.enumerate(),
    emitter,
    // Guard on typeof — a config literal baked by an older generator
    // (or a hand-written one in tests) may not carry the merge fields.
    ...(typeof config.serverURL === 'string' && config.serverURL !== ''
      ? {
          dataMerge: {
            serverURL: config.serverURL,
            ...(typeof config.apiRoute === 'string' ? { apiRoute: config.apiRoute } : {}),
            ...(typeof config.mergeDepth === 'number' ? { depth: config.mergeDepth } : {}),
          },
        }
      : {}),
    debounceMs: config.debounceMs,
    heartbeatMs: config.heartbeatMs,
    intersectionRootMargin: config.intersectionRootMargin,
    disableVisibilityGate: config.disableVisibilityGate,
    visibilityGateThreshold: config.visibilityGateThreshold,
    enableA11y: config.enableA11y,
    onHeartbeatTimeout: () => {
      detector.unlockOrigin();
    },
    ...(config.debug
      ? {
          log: (...args: unknown[]): void => {
            // eslint-disable-next-line no-console -- debug surface
            console.debug('[live-preview]', ...args);
          },
        }
      : {}),
  });

  // On the first valid connect, lock the detector to that origin so
  // every subsequent message must match it exactly.
  emitter.on('connect', (e) => {
    detector.lockOrigin(e.origin);
  });

  runtime.start();

  const api: LivePreviewGlobalApi = Object.freeze({
    version: VERSION,
    destroy: () => {
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
  });

  Object.defineProperty(window, '__livePreview', {
    value: api,
    writable: false,
    configurable: true,
  });

  return api;
}

function readBuildConfig(): typeof __LIVE_PREVIEW_CONFIG__ {
  // The defaults are kept in sync with `generateInlineScript`. The
  // build step replaces `__LIVE_PREVIEW_CONFIG__` with the consumer
  // configuration; outside of that build the literal is undefined.
  const baked: typeof __LIVE_PREVIEW_CONFIG__ | undefined =
    typeof __LIVE_PREVIEW_CONFIG__ === 'undefined' ? undefined : __LIVE_PREVIEW_CONFIG__;
  if (baked !== undefined) return baked;
  return {
    additionalOrigins: [],
    serverURL: '',
    apiRoute: '/api',
    mergeDepth: 1,
    debug: false,
    debounceMs: 50,
    enableA11y: true,
    heartbeatMs: 0,
    disableVisibilityGate: false,
    visibilityGateThreshold: 50,
    intersectionRootMargin: '200px',
    disableReferrerDetection: false,
    disableLocalhostMatching: false,
  };
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
