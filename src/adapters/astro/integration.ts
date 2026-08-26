/**
 * Astro integration for Payload Live Preview.
 *
 * Drop into `astro.config.mjs`:
 *
 * ```ts
 * import { defineConfig } from 'astro/config';
 * import { livePreview } from 'payload-live-preview/astro';
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
 *     requests carrying preview intent, and `frame-ancestors` CSP is
 *     managed. This is a delivery gate, not authentication. For
 *     authorization-gated response changes, register
 *     `createLivePreviewMiddleware()` manually after the application's
 *     server-side verifier. (`shouldInject` is not supported in this
 *     mode: options travel through a serialized virtual module.)
 *
 * @module @adapters/astro/integration
 */

import { generateInlineScript, generateLoaderScript } from '@inline/generator';
import { loaderAsset } from './loader-asset';
import type { LivePreviewAstroOptions } from './types';

// Local Astro type shims — keep `astro` as a runtime-optional peer.
type ScriptStage = 'head-inline' | 'page' | 'before-hydration' | 'page-ssr';
interface VitePluginLike {
  readonly name: string;
  readonly resolveId?: (id: string) => string | undefined;
  readonly load?: (id: string) => string | undefined;
  readonly configureServer?: (server: ViteDevServerLike) => void;
  readonly generateBundle?: (this: RollupEmitContext) => void;
}
/** The one Rollup facility this needs: publishing a file into the output. */
interface RollupEmitContext {
  emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void;
}
/** Just enough of Vite's dev server to serve one file. */
interface ViteDevServerLike {
  readonly middlewares: {
    use: (handler: (req: DevRequest, res: DevResponse, next: () => void) => void) => void;
  };
}
interface DevRequest {
  readonly url?: string | undefined;
}
interface DevResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}
interface AstroConfigSetupContext {
  readonly injectScript: (stage: ScriptStage, content: string) => void;
  readonly addMiddleware?: (entry: { entrypoint: string; order: 'pre' | 'post' }) => void;
  readonly updateConfig?: (config: { vite?: { plugins?: VitePluginLike[] } }) => void;
  /** Astro's configured `base`; absent on versions that do not expose it. */
  readonly config?: { readonly base?: string };
}
export interface AstroIntegrationLike {
  readonly name: string;
  readonly hooks: {
    readonly 'astro:config:setup': (ctx: AstroConfigSetupContext) => void;
  };
}

const VIRTUAL_OPTIONS_ID = 'virtual:payload-live-preview/options';
const RESOLVED_VIRTUAL_OPTIONS_ID = `\0${VIRTUAL_OPTIONS_ID}`;
const MIDDLEWARE_ENTRYPOINT = 'payload-live-preview/astro/middleware-entry';

/**
 * Build the Astro integration. The injected script auto-detects the
 * browser preview context and stays inert on ordinary top-level pages.
 * Browser-context detection does not authorize HTTP response changes.
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
        if (options.mode === 'loader') {
          setupLoaderMode(ctx, options);
          return;
        }
        ctx.injectScript('head-inline', generateInlineScript(inlineConfigFrom(options)));
      },
    },
  };
}

/**
 * Static delivery: inject a few hundred bytes, publish the runtime beside it.
 *
 * The bootstrap goes into every page like the inline script does, but it only
 * fetches the runtime when the page is actually a preview. Ordinary visitors
 * pay the bootstrap and nothing else.
 *
 * The asset is written twice over a project's life and by two different
 * mechanisms: a dev-server route while `astro dev` runs, and a real file when
 * the build finishes. Both serve the identical bytes from the identical path,
 * so a preview behaves the same in development and in production.
 */
function setupLoaderMode(ctx: AstroConfigSetupContext, options: LivePreviewAstroOptions): void {
  // Without `updateConfig` there is no Vite plugin, so nothing emits the asset
  // and nothing serves it — while the bootstrap is injected all the same and
  // points at a URL that will 404. That failure is invisible: ordinary pages
  // render fine and only a preview stays dead, with no message anywhere.
  // Refuse up front, the way middleware mode already does.
  if (ctx.updateConfig === undefined) {
    throw new Error(
      "payload-live-preview: mode 'loader' needs Astro's updateConfig hook " +
        '(Astro >= 4) to publish the runtime asset. Upgrade Astro or use the ' +
        'default inline mode.',
    );
  }

  const asset = loaderAsset(ctx.config?.base ?? '/');

  ctx.injectScript(
    'head-inline',
    generateLoaderScript(inlineConfigFrom(options), {
      runtimeSrc: asset.urlPath,
      integrity: asset.integrity,
    }),
  );

  // One plugin covers both lifetimes: `generateBundle` puts the file in the
  // build output, `configureServer` answers the same path during `astro dev`.
  // Emitting through Vite rather than writing it from an Astro hook keeps this
  // module free of Node builtins — it is reachable from a browser entry, and
  // the architecture policy refuses them there.
  ctx.updateConfig({
    vite: {
      plugins: [
        {
          name: 'payload-live-preview:loader-asset',
          generateBundle() {
            this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source });
          },
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              // Compare against the path only: a query string would otherwise
              // make the runtime 404 on the first cache-busting reload.
              const path = (req.url ?? '').split('?')[0];
              if (path !== asset.urlPath) {
                next();
                return;
              }
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
              // No long cache in development: the file changes whenever the
              // installed package does, and a stale one is hard to notice.
              res.setHeader('Cache-Control', 'no-cache');
              res.end(asset.source);
            });
          },
        },
      ],
    },
  });
}

/** Narrow adapter options down to what the inline generator accepts. */
function inlineConfigFrom(
  options: LivePreviewAstroOptions,
): Parameters<typeof generateInlineScript>[0] {
  return {
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.skipUnchanged !== undefined ? { skipUnchanged: options.skipUnchanged } : {}),
  };
}

function setupMiddlewareMode(ctx: AstroConfigSetupContext, options: LivePreviewAstroOptions): void {
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
