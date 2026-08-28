/**
 * The Astro integration for `astro.config.mjs`: `livePreview({ ... })`.
 * Inline and loader modes deliver at build time; middleware mode registers
 * the request-time middleware through a serialized options module.
 */

import { generateInlineScript, generateLoaderScript } from '@inline/generator';
import { loaderAsset } from './loader-asset';
import { inlineScriptConfig } from '@adapters/shared/policy';
import type { LivePreviewAstroOptions } from './types';

// Local shims keep `astro` a runtime-optional peer.
type ScriptStage = 'head-inline' | 'page' | 'before-hydration' | 'page-ssr';
interface VitePluginLike {
  readonly name: string;
  readonly resolveId?: (id: string) => string | undefined;
  readonly load?: (id: string) => string | undefined;
  readonly configureServer?: (server: ViteDevServerLike) => void;
  readonly generateBundle?: (this: RollupEmitContext) => void;
}
interface RollupEmitContext {
  emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void;
}
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

/** Build the integration. The injected runtime stays inert outside the admin's preview iframe. */
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
        ctx.injectScript('head-inline', generateInlineScript(inlineScriptConfig(options)));
      },
    },
  };
}

/**
 * Loader mode: a bootstrap in every page, the runtime published beside it.
 * One Vite plugin serves the identical bytes from the identical path during
 * `astro dev` (`configureServer`) and in the build (`generateBundle`).
 */
function setupLoaderMode(ctx: AstroConfigSetupContext, options: LivePreviewAstroOptions): void {
  // Without a Vite plugin nothing emits or serves the asset while the bootstrap
  // is injected anyway; that 404 is invisible until an editor opens a preview.
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
    generateLoaderScript(inlineScriptConfig(options), {
      runtimeSrc: asset.urlPath,
      integrity: asset.integrity,
    }),
  );

  // Emitting through Vite rather than writing from an Astro hook keeps this
  // module free of Node builtins: it is reachable from a browser entry.
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
              // Path only: a cache-busting query string must still resolve.
              const path = (req.url ?? '').split('?')[0];
              if (path !== asset.urlPath) {
                next();
                return;
              }
              res.statusCode = 200;
              res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
              // The file changes with the installed package; a stale one is hard to notice.
              res.setHeader('Cache-Control', 'no-cache');
              res.end(asset.source);
            });
          },
        },
      ],
    },
  });
}

function setupMiddlewareMode(ctx: AstroConfigSetupContext, options: LivePreviewAstroOptions): void {
  if (ctx.addMiddleware === undefined || ctx.updateConfig === undefined) {
    throw new Error(
      "payload-live-preview: mode 'middleware' needs Astro's addMiddleware/updateConfig " +
        'hooks (Astro >= 4). Upgrade Astro or use the default inline mode.',
    );
  }
  if (options.authorizePreview !== undefined) {
    throw new Error(
      "payload-live-preview: `authorizePreview` cannot be used with mode 'middleware' — " +
        'options are serialized into the build. Compose `createLivePreviewMiddleware()` ' +
        'in your own `src/middleware.ts` to pass the hook.',
    );
  }
  if (options.shouldInject !== undefined) {
    throw new Error(
      "payload-live-preview: `shouldInject` cannot be used with mode 'middleware' — " +
        'options are serialized into the build. Use `previewQueryParams`/`previewSignals`, ' +
        'or register createLivePreviewMiddleware() manually in src/middleware.ts.',
    );
  }
  // Strict needs `authorizePreview`, which cannot serialize: refuse here rather
  // than build cleanly and fail on every preview request.
  const willBeStrict = options.strict ?? options.defaults !== 'v1';
  if (willBeStrict) {
    throw new Error(
      "payload-live-preview: mode 'middleware' cannot satisfy the 2.0 strict default — it " +
        'serializes its options into the build, so it cannot carry the `authorizePreview` ' +
        'function strict mode requires. Either register ' +
        '`createLivePreviewMiddleware({ authorizePreview, ... })` yourself in src/middleware.ts ' +
        '(recommended: response changes stay gated on a verified context), or pass ' +
        "`defaults: 'v1'` (or `strict: false`) to run intent-only middleware " +
        '(ADR 0006 explains why intent is not authorization).',
    );
  }

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
