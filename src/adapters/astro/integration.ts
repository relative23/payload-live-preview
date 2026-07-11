/**
 * Astro integration for Payload Live Preview.
 *
 * Drop into `astro.config.mjs`:
 *
 * ```ts
 * import { defineConfig } from 'astro/config';
 * import { livePreview } from '@relative23/payload-live-preview/astro';
 *
 * export default defineConfig({
 *   integrations: [livePreview({ allowedOrigins: ['https://admin.example.com'] })],
 * });
 * ```
 *
 * The integration uses Astro's `injectScript('head-inline', …)` to put
 * the inline preview runtime at the top of every page. For per-request
 * CSP nonces, register the dedicated middleware factory exported from
 * `./middleware`; the two are independent.
 *
 * @module @adapters/astro/integration
 */

import { generateInlineScript } from '@inline/generator';
import type { LivePreviewAstroOptions } from './types';

// Local Astro type shims — keep `astro` as a runtime-optional peer.
type ScriptStage = 'head-inline' | 'page' | 'before-hydration' | 'page-ssr';
interface AstroConfigSetupContext {
  readonly injectScript: (stage: ScriptStage, content: string) => void;
}

export interface AstroIntegrationLike {
  readonly name: string;
  readonly hooks: {
    readonly 'astro:config:setup': (ctx: AstroConfigSetupContext) => void;
  };
}

/**
 * Build the Astro integration. The injected script auto-detects the
 * preview context — pages opened directly (not in an iframe) are
 * unaffected.
 */
export function livePreview(options: LivePreviewAstroOptions = {}): AstroIntegrationLike {
  return {
    name: 'payload-live-preview',
    hooks: {
      'astro:config:setup': ({ injectScript }): void => {
        if (options.autoInject === false) return;
        const script = generateInlineScript({
          ...(options.allowedOrigins !== undefined
            ? { allowedOrigins: options.allowedOrigins }
            : {}),
          ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
          ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
          ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
          ...(options.debug !== undefined ? { debug: options.debug } : {}),
          ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
          ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
        });
        injectScript('head-inline', script);
      },
    },
  };
}
