/**
 * The inline runtime's entry point: read the baked configuration, decide
 * whether this window is a preview at all, and wire the runtime to a small
 * `window.__livePreview` API. `scripts/build-runtime.ts` bundles this file
 * into the IIFE that adapters inject; the programmatic client imports
 * `bootstrapInlineRuntime` and calls it itself.
 */

import { definedOnly } from '@/types/defined-only';
import { type INLINE_CONFIG_KEYS, type InlineScriptConfig } from '@/types/inline-config';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from './lifecycle';
import { resolveStrategyPreludes } from '../strategies/strategy-preludes';
import { OriginDetector } from '@detection/origin';
import { isInPreviewContext, isInIframe, isInPopup } from '@detection/environment';
import { bindNavigationLifecycle } from './navigation-lifecycle';
import { VERSION } from '../../version';
import type { LivePreviewInspection } from '../inspection/types';
import type { FieldRenderer } from '../types';
import { safeConsoleDebug, safeConsoleWarn } from '../diagnostics';

/** Positional wire format, derived from the key table `src/inline/generator.ts` writes. */
type ConfigTupleOf<K extends readonly PropertyKey[]> = {
  // A retired slot has no option behind it, and nothing is read from it.
  readonly [I in keyof K]?: K[I] extends keyof InlineScriptConfig
    ? InlineScriptConfig[K[I]]
    : undefined;
};
type RuntimeBuildConfig = ConfigTupleOf<typeof INLINE_CONFIG_KEYS>;

declare const __LIVE_PREVIEW_CONFIG__: RuntimeBuildConfig;

import { buildBuiltinRenderers } from '@field-types/index';

/** The small API on `window.__livePreview`; anything richer belongs in the client. */
export interface LivePreviewGlobalApi {
  /** The configuration this instance was built from; a different one triggers a handover. */
  readonly configSignature?: string;
  readonly destroy: () => void;
  /** Re-scan bindings without crossing a navigation boundary. */
  readonly refresh: () => void;
  /** Commit a router navigation and locally replay the last accepted document. */
  readonly refreshAfterNavigation: () => void;
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

  // An empty slot is an option nobody set: the detector and the runtime below take its row of
  // the defaults table, so no default is written here.
  const [
    additionalOrigins = [],
    serverURL = '',
    apiRoute,
    mergeDepth,
    debug,
    debounceMs,
    enableA11y,
    heartbeatMs,
    _disableVisibilityGate,
    visibilityGateThreshold,
    intersectionRootMargin,
    _disableReferrerDetection,
    _disableLocalhostMatching,
    scopeBindingsByOwner,
    skipUnchanged,
    eventSourcePolicy,
    sanitizerPolicy,
    fragmentEndpoint,
    revealEditedField,
    routeStrategy,
    _onUnboundChange,
    onUnfaithfulPatch,
    autoBind,
    hydration,
    _defaults,
    softNavigationEvents = [],
    subfieldCoverage,
    mergeTimeoutMs,
    internalLinkPattern,
    enableVisibilityGate,
    enableReferrerDetection,
    enableLocalhostMatching,
  ] = readBuildConfig();
  // Which prelude the generator emitted is what the runtime can observe of
  // `routeStrategy`, whose slot adds only when a route may run.
  const strategies = resolveStrategyPreludes(fragmentEndpoint);

  const detector = new OriginDetector(
    definedOnly({ additionalOrigins, enableReferrerDetection, enableLocalhostMatching }),
  );

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

  const runtime = new LivePreviewRuntime(
    definedOnly({
      renderers,
      originMatcher: (origin: string) => detector.matches(origin),
      lockedOrigin: () => detector.lockedOrigin,
      readyTargets: () => detector.enumerate(),
      emitter,
      eventSourcePolicy,
      dataMerge:
        serverURL === ''
          ? undefined
          : definedOnly({ serverURL, apiRoute, depth: mergeDepth, timeoutMs: mergeTimeoutMs }),
      internalLinkPattern,
      routeAfterSave: routeStrategy === 'after-save' ? true : undefined,
      debounceMs,
      heartbeatMs,
      intersectionRootMargin,
      enableVisibilityGate,
      visibilityGateThreshold,
      enableA11y,
      scopeBindingsByOwner,
      subfieldCoverage,
      skipUnchanged,
      revealEditedField,
      onUnfaithfulPatch,
      autoBind,
      hydration,
      sanitizerPolicy,
      strategies,
      onHeartbeatTimeout: () => {
        detector.unlockOrigin();
      },
      log:
        debug === true
          ? (...args: unknown[]): void => {
              safeConsoleDebug('[live-preview]', ...args);
            }
          : undefined,
    }),
  );

  // The first accepted update locks the detector to that origin.
  emitter.on('connect', (e) => {
    detector.lockOrigin(e.origin);
  });

  runtime.start();
  // The replacement is live before the previous instance goes.
  existing?.destroy();

  // Every adapter injects this entry, so owning the lifecycle here is what makes
  // bfcache recovery and an adapter's declared router event reachable at all.
  const unbindLifecycle = bindNavigationLifecycle(
    {
      suspend: () => runtime.suspend(),
      resume: () => runtime.start(),
      refreshCache: () => {
        runtime.refreshCache();
      },
      refreshAfterNavigation: () => {
        runtime.navigationCommit();
      },
    },
    { softNavigationEvents },
  );

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
    refreshAfterNavigation: () => {
      runtime.navigationCommit();
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
