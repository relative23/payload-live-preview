/**
 * Helpers for embedding the live preview manually in `.astro` templates.
 *
 * Most consumers should prefer the `livePreview()` integration which
 * auto-injects the script. This module exists for advanced cases where
 * the script needs to live inside a specific layout or behind a
 * conditional.
 *
 * Usage in a `.astro` file:
 *
 * ```astro
 * ---
 * import { renderLivePreviewScript } from 'payload-live-preview/astro';
 * const script = renderLivePreviewScript({
 *   allowedOrigins: ['https://admin.example.com'],
 *   nonce: Astro.locals.livePreviewNonce,
 * });
 * ---
 * <Fragment set:html={script} />
 * ```
 *
 * @module @adapters/astro/component
 */

import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import type { LivePreviewAstroOptions } from './types';
import { inlineScriptConfig } from '@adapters/shared/policy';

export interface RenderScriptOptions extends LivePreviewAstroOptions {
  /**
   * CSP nonce to set on the `<script>` tag. Read from
   * `Astro.locals.livePreviewNonce` after registering the live-preview
   * middleware.
   */
  readonly nonce?: string;
}

/**
 * Render the full `<script>` tag (wrapped with attributes) for embedding
 * in a `.astro` layout. The result is a single string suitable for
 * `set:html={…}`.
 */
export function renderLivePreviewScript(options: RenderScriptOptions = {}): string {
  const body = generateInlineScript(inlineScriptConfig(options));
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}
