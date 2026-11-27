/**
 * Wraps the build-time runtime IIFE with the consumer's configuration, and
 * places at most one strategy prelude ahead of it.
 */

import { refuseRemovedOptions } from '@/types/removed-options';
import { assertMergeDepthExplicit } from '@/types/merge-depth';
import { RUNTIME_SOURCE, RUNTIME_BUILD_INFO, type RuntimeBuildInfo } from './runtime.generated';
import { FRAGMENT_SOURCE } from './fragment.generated';
import { ROUTE_SOURCE } from './route.generated';
import { LOADER_SOURCE } from './loader.generated';
import { LOADER_REACT_SOURCE } from './loader-react.generated';
import { INLINE_CONFIG_KEYS, type InlineScriptConfig } from '@/types/inline-config';

export type { InlineScriptConfig } from '@/types/inline-config';

function assertBuilt(source: string, artifact: string): void {
  if (source.length === 0) {
    throw new Error(
      `[live-preview] ${artifact} is empty. Run \`npm run build:runtime\` before bundling.`,
    );
  }
}

/** The inline script body without `<script>` tags; see `wrapWithScriptTag()`. */
export function generateInlineScript(config: InlineScriptConfig = {}): string {
  assertBuilt(RUNTIME_SOURCE, 'runtime.generated.ts');
  return [configStatement(config), ...strategyPrelude(config), RUNTIME_SOURCE].join('\n');
}

function hasRouteStrategy(config: InlineScriptConfig): boolean {
  return config.routeStrategy !== undefined && config.routeStrategy !== false;
}

/**
 * At most one prelude, and the fragment one wins: it already contains the
 * route strategy, so emitting both would ship that code twice and leave two
 * globals where the runtime expects the fragment one to be authoritative.
 */
function strategyPrelude(config: InlineScriptConfig): readonly string[] {
  if (config.fragmentEndpoint != null) {
    assertBuilt(FRAGMENT_SOURCE, 'fragment.generated.ts');
    return [FRAGMENT_SOURCE];
  }
  if (hasRouteStrategy(config)) {
    assertBuilt(ROUTE_SOURCE, 'route.generated.ts');
    return [ROUTE_SOURCE];
  }
  return [];
}

// `__LIVE_PREVIEW_CONFIG__` is a public presence signal: consumers' integration
// tests grep for it, so the name outlives any refactor.
function configStatement(config: InlineScriptConfig): string {
  return `var __LIVE_PREVIEW_CONFIG__=${buildConfigLiteral(config)};`;
}

/** The positional wire literal the runtime destructures; shared by the inline script and the loader. */
function buildConfigLiteral(config: InlineScriptConfig): string {
  refuseRemovedOptions(config);
  assertMergeDepthExplicit(config);
  // Slot 24 names the table an empty slot belongs to, so a reader of the served page, the
  // doctor among them, knows which generation wrote it (ADR 0007).
  const profile: Partial<InlineScriptConfig> = { defaults: 'v2' };
  // `null` counts as omitted, and omitted slots stay empty (`[,,1]`): a JSON
  // `null` would bypass the runtime's destructuring defaults. Defaults remains
  // in its established slot 24; later rows are append-only and may be absent.
  // Read by name: a retired slot has no option behind it, and the refusal above lets no value
  // for one through, so it stays empty.
  const given = config as Readonly<Record<string, unknown>>;
  const filled = profile as Readonly<Record<string, unknown>>;
  const values: unknown[] = INLINE_CONFIG_KEYS.map((key) => {
    const value = given[key] ?? filled[key];
    assertSerializable(key, value);
    return value;
  });
  while (values.at(-1) === undefined) values.pop();
  // `<` is escaped so a value containing `</script>` cannot end the tag.
  return `[${values
    .map((value) => (value === undefined ? '' : JSON.stringify(value)))
    .join(',')}]`.replace(/</g, '\\u003C');
}

/**
 * JSON writes `Infinity` and `NaN` as `null`, which the runtime does not read
 * as the number: the option would be lost without a word.
 */
function assertSerializable(key: string, value: unknown): void {
  if (typeof value !== 'number' || Number.isFinite(value)) return;
  const instead =
    key === 'visibilityGateThreshold' ? ' To never defer, set `enableVisibilityGate: false`.' : '';
  throw new Error(
    `[live-preview] \`${key}\` is ${String(value)}, which the inline configuration writes as null, ` +
      `so the runtime would never see it. Pass a finite number.${instead}`,
  );
}

/** Where the runtime asset lives, and how the browser should verify it. */
export interface LoaderScriptTarget {
  /** URL the bootstrap appends. Same-origin or absolute; hashed by the caller. */
  readonly runtimeSrc: string;
  /** Subresource-integrity value, e.g. `sha384-…`; empty drops the check and the `crossorigin` it requires. */
  readonly integrity?: string;
}

/**
 * The static-delivery bootstrap: the configuration plus a few hundred bytes
 * appending the runtime inside a preview. The asset stays configuration-free.
 */
export function generateLoaderScript(
  config: InlineScriptConfig = {},
  target: LoaderScriptTarget,
): string {
  const bootstrap = loaderFor(config);
  if (target.runtimeSrc === '') {
    throw new Error('[live-preview] generateLoaderScript needs a runtimeSrc.');
  }
  const encode = (value: string): string => JSON.stringify(value).replace(/</gu, '\\u003C');
  return [
    configStatement(config),
    `var __LP_RUNTIME_SRC__=${encode(target.runtimeSrc)};`,
    `var __LP_RUNTIME_INTEGRITY__=${encode(target.integrity ?? '')};`,
    ...strategyPrelude(config),
    bootstrap,
  ].join('\n');
}

/**
 * The bootstrap, or the one armed for React's first commit (ADR 0015 F2): the
 * inline runtime is the first script in `<head>` and arms the signal itself,
 * while a fetched asset may evaluate after `react-dom` has, when it is too
 * late — so on a page that declares React the bootstrap arms before it
 * fetches. One script either way, never a prelude ahead of the plain one. A
 * page that declares Vue takes the plain one: Vue's mount leaves state on the
 * container that a late runtime can still read (`core/hydration-vue`).
 */
function loaderFor(config: InlineScriptConfig): string {
  if (config.hydration === 'react') {
    assertBuilt(LOADER_REACT_SOURCE, 'loader-react.generated.ts');
    return LOADER_REACT_SOURCE;
  }
  assertBuilt(LOADER_SOURCE, 'loader.generated.ts');
  return LOADER_SOURCE;
}

/** Wrap a script body in `<script>`, with the CSP nonce attribute when given. */
export function wrapWithScriptTag(body: string, options: { nonce?: string } = {}): string {
  const nonceAttr = options.nonce !== undefined ? ` nonce="${assertNonce(options.nonce)}"` : '';
  return `<script${nonceAttr}>${body}</script>`;
}

/** @internal */
export function runtimeBuildInfo(): RuntimeBuildInfo {
  return RUNTIME_BUILD_INFO;
}

/**
 * A nonce as CSP defines it: base64url characters only. Returned unchanged so
 * a caller can inline the result. Not re-exported from the package barrel — it
 * is shared with the adapters, not part of the public surface.
 */
export function assertNonce(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new RangeError('nonce contains characters CSP does not allow');
  }
  return nonce;
}
