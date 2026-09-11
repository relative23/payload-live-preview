/**
 * The inline runtime's entry point: read the baked configuration, decide
 * whether this window is a preview at all, and wire the runtime to a small
 * `window.__livePreview` API. `scripts/build-runtime.ts` bundles this file
 * into the IIFE that adapters inject; the programmatic client imports
 * `bootstrapInlineRuntime` and calls it itself.
 */

import { type INLINE_CONFIG_KEYS, type InlineScriptConfig } from '@/types/inline-config';
import { EventEmitter } from '@events/emitter';
import { resolveUnfaithfulPatchMode } from './fidelity';
import { LivePreviewRuntime } from './lifecycle';
import { resolveStrategyPreludes } from './strategy-preludes';
import { OriginDetector } from '@detection/origin';
import { isInPreviewContext, isInIframe, isInPopup } from '@detection/environment';
import { bindNavigationLifecycle } from './navigation-lifecycle';
import { VERSION } from '../version';
import type { LivePreviewInspection } from './inspection/types';
import type { FieldRenderer } from './types';
import { safeConsoleDebug, safeConsoleWarn } from './diagnostics';

/** Positional wire format, derived from the key table `src/inline/generator.ts` writes. */
type ConfigTupleOf<K extends readonly (keyof InlineScriptConfig)[]> = {
  readonly [I in keyof K]?: InlineScriptConfig[K[I]];
};
type RuntimeBuildConfig = ConfigTupleOf<typeof INLINE_CONFIG_KEYS>;

declare const __LIVE_PREVIEW_CONFIG__: RuntimeBuildConfig;

import { buildBuiltinRenderers } from '@field-types/index';

/** The small API on `window.__livePreview`; anything richer belongs in the client. */
export interface LivePreviewGlobalApi {
  /** The configuration this instance was built from; a different one triggers a handover. */
  readonly configSignature?: string;
  readonly destroy: () => void;
  readonly refresh: () => void;
  readonly enumerateOrigins: () => readonly string[];
  /** Reachable from the console as `__livePreview.inspect()` — an adapter user has no client object. */
  readonly inspect: () => LivePreviewInspection;
  readonly version: string;
}

/** Returns `undefined` outside a preview context: a top-level visit must never start the runtime. */
export function bootstrapInlineRuntime(): LivePreviewGlobalApi | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!isInPreviewContext()) return undefined;

  // A second bootstrap is either a double injection or a soft navigation that
  // re-ran the script. Same configuration: the running instance stays and
  // rescans. Different: hand over, replacement first, so a message in between
  // still reaches one of them.
  const existing = (window as { __livePreview?: LivePreviewGlobalApi }).__livePreview;
  const signature = JSON.stringify(readBuildConfig());
  if (existing !== undefined) {
    if (existing.configSignature === undefined || existing.configSignature === signature) {
      existing.refresh();
      return existing;
    }
  }

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
    disableReferrerDetection = true,
    disableLocalhostMatching = false,
    scopeBindingsByOwner = false,
    skipUnchanged = true,
    eventSourcePolicy = 'parent-or-opener',
    sanitizerPolicy = 'strict',
    fragmentEndpoint,
    revealEditedField = false,
    _routeStrategy = false,
    onUnboundChange,
    onUnfaithfulPatch,
    autoBind = 'off',
    hydration,
  ] = readBuildConfig();
  // `routeStrategy` is destructured only to hold its wire slot: it decides
  // which prelude the generator emitted, and the prelude's presence is what the
  // runtime can observe.
  const strategies = resolveStrategyPreludes(fragmentEndpoint);

  const detector = new OriginDetector({
    additionalOrigins,
    enableReferrerDetection: !disableReferrerDetection,
    enableLocalhostMatching: !disableLocalhostMatching,
  });

  if (detector.isProductionUnconfigured) {
    safeConsoleWarn(
      '[live-preview] LP0101: No trusted origin. Pass allowedOrigins to generateInlineScript() ' +
        '(or to the adapter) — the runtime reads no environment variable in the browser.',
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
    readyTargets: () => detector.enumerate(),
    emitter,
    eventSourcePolicy,
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
    revealEditedField,
    // Resolved here rather than passed through as two slots: an empty slot must
    // not read as a chosen `'ignore'`, and the runtime takes one answer.
    onUnfaithfulPatch: resolveUnfaithfulPatchMode({ onUnfaithfulPatch, onUnboundChange }),
    autoBind,
    ...(hydration !== undefined ? { hydration } : {}),
    sanitizerPolicy,
    ...(strategies !== undefined ? { strategies } : {}),
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

  // The first accepted update locks the detector to that origin.
  emitter.on('connect', (e) => {
    detector.lockOrigin(e.origin);
  });

  runtime.start();
  // The replacement is live before the previous instance goes.
  existing?.destroy();

  // Every adapter injects this entry, so owning the lifecycle here is what makes
  // bfcache recovery reachable at all. Soft navigation stays unbound: only the
  // host knows which event its router fires.
  const unbindLifecycle = bindNavigationLifecycle({
    suspend: () => runtime.suspend(),
    resume: () => runtime.start(),
    refreshCache: () => {
      runtime.refreshCache();
    },
  });

  const api: LivePreviewGlobalApi = Object.freeze({
    version: VERSION,
    configSignature: signature,
    destroy: () => {
      unbindLifecycle();
      runtime.destroy();
      // Clear the handle so a later bootstrap starts fresh instead of
      // returning this dead API; the property is `configurable` for this.
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
    // Starting and publishing are one transaction: a pre-existing global
    // descriptor must not leave an unreachable runtime listening.
    unbindLifecycle();
    runtime.destroy();
    throw error;
  }

  return api;
}

function readBuildConfig(): RuntimeBuildConfig {
  return typeof __LIVE_PREVIEW_CONFIG__ === 'undefined' ? [] : __LIVE_PREVIEW_CONFIG__;
}

// Auto-start only in the inline build; the client calls the bootstrap itself.
// The define is read at the branch: assigned to a variable first, esbuild
// substitutes it but no longer folds the branch away.
declare const __INLINE_BUILD__: boolean | undefined;
if (typeof __INLINE_BUILD__ !== 'undefined' && __INLINE_BUILD__) {
  void bootstrapInlineRuntime();
}

export const __RUNTIME_HELPERS_FOR_TESTS = {
  isInIframe,
  isInPopup,
  isInPreviewContext,
};
