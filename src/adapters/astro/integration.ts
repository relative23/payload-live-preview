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
 * Two injection modes:
 *
 *   - **`mode: 'inline'`** (default) — `injectScript('head-inline', …)`
 *     bakes the runtime into every page at build time. Right choice
 *     for `output: 'static'`, where no middleware runs at request
 *     time. The runtime stays inert outside the admin iframe.
 *   - **`mode: 'middleware'`** — registers the preview middleware via
 *     `addMiddleware()`: the runtime is injected at request time into
 *     preview requests only, and `frame-ancestors` CSP is managed.
 *     Right choice for `output: 'server'` — production responses ship
 *     zero preview bytes. (`shouldInject` is not supported in this
 *     mode: options travel through a serialized virtual module.)
 *
 * @module @adapters/astro/integration
 */

import { generateInlineScript } from '@inline/generator';
import type { LivePreviewAstroOptions } from './types';

// Local Astro type shims — keep `astro` as a runtime-optional peer.
type ScriptStage = 'head-inline' | 'page' | 'before-hydration' | 'page-ssr';
interface VitePluginLike {
  readonly name: string;
  readonly resolveId: (id: string) => string | undefined;
  readonly load: (id: string) => string | undefined;
}
interface AstroConfigSetupContext {
  readonly injectScript: (stage: ScriptStage, content: string) => void;
  readonly addMiddleware?: (entry: { entrypoint: string; order: 'pre' | 'post' }) => void;
  readonly updateConfig?: (config: {
    vite?: { plugins?: VitePluginLike[] };
  }) => void;
}

export interface AstroIntegrationLike {
  readonly name: string;
  readonly hooks: {
    readonly 'astro:config:setup': (ctx: AstroConfigSetupContext) => void;
  };
}

const VIRTUAL_OPTIONS_ID = 'virtual:payload-live-preview/options';
const RESOLVED_VIRTUAL_OPTIONS_ID = `\0${VIRTUAL_OPTIONS_ID}`;
const MIDDLEWARE_ENTRYPOINT = '@relative23/payload-live-preview/astro/middleware-entry';

/**
 * Build the Astro integration. The injected script auto-detects the
 * preview context — pages opened directly (not in an iframe) are
 * unaffected.
 */
export function livePreview(options: LivePreviewAstroOptions = {}): AstroIntegrationLike {
  return {
    name: 'payload-live-preview',
    hooks: {
      'astro:config:setup': (ctx): void => {
        if (options.mode === 'middleware') {
          setupMiddlewareMode(ctx, options);
          return;
        }
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
        ctx.injectScript('head-inline', script);
      },
    },
  };
}

function setupMiddlewareMode(
  ctx: AstroConfigSetupContext,
  options: LivePreviewAstroOptions,
): void {
  if (ctx.addMiddleware === undefined || ctx.updateConfig === undefined) {
    throw new Error(
      "payload-live-preview: mode 'middleware' needs Astro's addMiddleware/updateConfig " +
        'hooks (Astro >= 4). Upgrade Astro or use the default inline mode.',
    );
  }
  if (options.shouldInject !== undefined) {
    throw new Error(
      "payload-live-preview: `shouldInject` cannot be used with mode 'middleware' — " +
        'options are serialized into the build. Use `previewQueryParams`/`previewSignals`, ' +
        'or register createLivePreviewMiddleware() manually in src/middleware.ts.',
    );
  }

  // Everything except functions serializes cleanly.
  const { mode: _mode, shouldInject: _shouldInject, ...serializable } = options;
  const optionsModule = `export default ${JSON.stringify(serializable).replace(/</g, '\\u003C')};`;

  ctx.updateConfig({
    vite: {
      plugins: [
        {
          name: 'payload-live-preview-options',
          resolveId: (id) => (id === VIRTUAL_OPTIONS_ID ? RESOLVED_VIRTUAL_OPTIONS_ID : undefined),
          load: (id) => (id === RESOLVED_VIRTUAL_OPTIONS_ID ? optionsModule : undefined),
        },
      ],
    },
  });
  ctx.addMiddleware({ entrypoint: MIDDLEWARE_ENTRYPOINT, order: 'pre' });
}
