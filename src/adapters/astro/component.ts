/**
 * Manual embedding for `.astro` templates, for the cases the integration's
 * automatic injection does not fit (one layout, a conditional).
 */

import { renderScriptTag } from '@adapters/shared/response';
import type { LivePreviewAstroOptions } from './types';

export interface RenderScriptOptions extends LivePreviewAstroOptions {
  /** CSP nonce for the tag; read it from `Astro.locals.livePreviewNonce`. */
  readonly nonce?: string;
}

/** The complete `<script>` tag, for `<Fragment set:html={renderLivePreviewScript(...)} />`. */
export function renderLivePreviewScript(options: RenderScriptOptions = {}): string {
  return renderScriptTag(options);
}
