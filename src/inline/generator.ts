/**
 * Wraps the build-time runtime IIFE with the consumer's configuration; a page
 * with a fragment endpoint gets the fragment prelude ahead of it.
 */

import { RUNTIME_SOURCE, RUNTIME_BUILD_INFO, type RuntimeBuildInfo } from './runtime.generated';
import { FRAGMENT_SOURCE } from './fragment.generated';
import { LOADER_SOURCE } from './loader.generated';
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
  return [configStatement(config), ...fragmentPrelude(config), RUNTIME_SOURCE].join('\n');
}

function fragmentPrelude(config: InlineScriptConfig): readonly string[] {
  if (config.fragmentEndpoint == null) return [];
  assertBuilt(FRAGMENT_SOURCE, 'fragment.generated.ts');
  return [FRAGMENT_SOURCE];
}

// `__LIVE_PREVIEW_CONFIG__` is a public presence signal: consumers' integration
// tests grep for it, so the name outlives any refactor.
function configStatement(config: InlineScriptConfig): string {
  return `var __LIVE_PREVIEW_CONFIG__=${buildConfigLiteral(config)};`;
}

/** The positional wire literal the runtime destructures; shared by the inline script and the loader. */
function buildConfigLiteral(config: InlineScriptConfig): string {
  if (config.defaults !== 'v1' && (config.serverURL ?? '') !== '' && config.mergeDepth == null) {
    throw new Error(
      'payload-live-preview: `serverURL` needs an explicit `mergeDepth` under the 2.0 defaults — ' +
        "choose the population depth deliberately (0 for none), or pass `defaults: 'v1'` to keep " +
        'the 1.x default of 1 while migrating (ADR 0007, entry 10).',
    );
  }
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
  assertBuilt(LOADER_SOURCE, 'loader.generated.ts');
  if (target.runtimeSrc === '') {
    throw new Error('[live-preview] generateLoaderScript needs a runtimeSrc.');
  }
  const encode = (value: string): string => JSON.stringify(value).replace(/</gu, '\\u003C');
  return [
    configStatement(config),
    `var __LP_RUNTIME_SRC__=${encode(target.runtimeSrc)};`,
    `var __LP_RUNTIME_INTEGRITY__=${encode(target.integrity ?? '')};`,
    ...fragmentPrelude(config),
    LOADER_SOURCE,
  ].join('\n');
}

/** Wrap a script body in `<script>`, with the CSP nonce attribute when given. */
export function wrapWithScriptTag(body: string, options: { nonce?: string } = {}): string {
  const nonceAttr = options.nonce !== undefined ? ` nonce="${escapeNonce(options.nonce)}"` : '';
  return `<script${nonceAttr}>${body}</script>`;
}

export function runtimeBuildInfo(): RuntimeBuildInfo {
  return RUNTIME_BUILD_INFO;
}

function escapeNonce(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new RangeError('wrapWithScriptTag: nonce contains invalid characters');
  }
  return nonce;
}
