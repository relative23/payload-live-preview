/**
 * Wraps the build-time runtime IIFE with the consumer's configuration, and
 * places at most one strategy prelude ahead of it.
 */

import { assertMergeDepthExplicit } from '@/types/merge-depth';
import { RUNTIME_SOURCE, RUNTIME_BUILD_INFO, type RuntimeBuildInfo } from './runtime.generated';
import { FRAGMENT_SOURCE } from './fragment.generated';
import { ROUTE_SOURCE } from './route.generated';
import { LOADER_SOURCE } from './loader.generated';
import { LOADER_REACT_SOURCE } from './loader-react.generated';
import { INLINE_CONFIG_KEYS, type InlineScriptConfig } from '@/types/inline-config';

export type { InlineScriptConfig, RuntimeArtifact } from '@/types/inline-config';

function assertBuilt(source: string, artifact: string): void {
  if (source.length === 0) {
    throw new Error(
      `[live-preview] ${artifact} is empty. Run \`npm run build:runtime\` before bundling.`,
    );
  }
}

/** The inline script body without `<script>` tags; see `wrapWithScriptTag()`. */
export function generateInlineScript(config: InlineScriptConfig = {}): string {
  const runtime = runtimeFor(config);
  return [configStatement(config), ...strategyPrelude(config), runtime].join('\n');
}

/**
 * The full runtime, or the artifact the consumer imported. The lean one leaves
 * out the strategies (docs/options.md), so the two preludes are refused with it
 * rather than emitted against a runtime that could never answer them.
 */
function runtimeFor(config: InlineScriptConfig): string {
  const artifact = config.runtime;
  if (artifact === undefined) {
    assertBuilt(RUNTIME_SOURCE, 'runtime.generated.ts');
    return RUNTIME_SOURCE;
  }
  assertBuilt(artifact.source, `the ${artifact.profile} runtime`);
  if (config.fragmentEndpoint != null || config.routeStrategy === true) {
    throw new Error(
      `[live-preview] the ${artifact.profile} runtime and the fragment or route strategy exclude ` +
        'each other: it carries no strategy runner, so the prelude would have nothing to talk to. ' +
        'Drop the runtime option, or drop `fragmentEndpoint`/`routeStrategy`.',
    );
  }
  return artifact.source;
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
  if (config.routeStrategy === true) {
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
  assertMergeDepthExplicit(config);
  // `null` counts as omitted, and omitted slots stay empty (`[,,1]`): a JSON
  // `null` would bypass the runtime's destructuring defaults.
  const values: unknown[] = INLINE_CONFIG_KEYS.map((key) => config[key] ?? undefined);
  while (values.length > 0 && values.at(-1) === undefined) values.pop();
  // `<` is escaped so a value containing `</script>` cannot end the tag.
  return `[${values
    .map((value) => (value === undefined ? '' : JSON.stringify(value)))
    .join(',')}]`.replace(/</g, '\\u003C');
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
 * late — so on a page that declares hydration the bootstrap arms before it
 * fetches. One script either way, never a prelude ahead of the plain one.
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
