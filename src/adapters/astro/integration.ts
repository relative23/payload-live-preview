/**
 * The Astro integration for `astro.config.mjs`: `livePreview({ ... })`.
 * Inline and loader modes deliver at build time; middleware mode registers
 * the request-time middleware through a serialized options module. Every
 * build also records its island module table for fragment containers (ADR 0021).
 */

import { generateInlineScript, generateLoaderScript } from '@inline/generator';
import { loaderAsset } from './loader-asset';
import { hookImportLines, refuseOutsideReference } from '@adapters/shared/hook-reference';
import { inlineScriptConfig } from '@adapters/shared/policy-options';
import type { LivePreviewAstroOptions } from './types';
import { ASTRO_PAGE } from './page-facts';
import { islandModuleTable, writeIslandTable } from './island-table';

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
// The build hooks' contexts stay structural and inline: Astro hands richer
// objects, and naming them here would only widen the public type surface.
export interface AstroIntegrationLike {
  readonly name: string;
  readonly hooks: {
    readonly 'astro:config:setup': (ctx: AstroConfigSetupContext) => void;
    readonly 'astro:config:done': (ctx: {
      readonly config: { readonly build?: { readonly server?: URL } };
    }) => void;
    readonly 'astro:build:ssr': (ctx: {
      readonly manifest: {
        readonly entryModules?: Readonly<Record<string, string>>;
        readonly base?: string;
        readonly assetsPrefix?: string | Readonly<Record<string, string>>;
      };
    }) => void;
    readonly 'astro:build:done': (ctx: {
      readonly logger?: { readonly info: (message: string) => void };
    }) => Promise<void>;
  };
}

interface NodeFiles {
  readonly readdir: (path: string, options: { recursive: true }) => Promise<string[]>;
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
  readonly writeFile: (path: string, data: string) => Promise<void>;
}
interface NodeUrl {
  readonly fileURLToPath: (url: URL) => string;
}

/**
 * Node builtins, looked up only while Astro builds. A static import would
 * break this module's browser reachability (see the loader-mode note below).
 */
function builtin(id: string): unknown {
  const process: unknown = Reflect.get(globalThis, 'process');
  const lookup: unknown =
    typeof process === 'object' && process !== null
      ? Reflect.get(process, 'getBuiltinModule')
      : undefined;
  return typeof lookup === 'function' ? (lookup.call(process, id) as unknown) : undefined;
}

/** Write the island table into every server chunk that carries its placeholder. */
async function writeIslandModules(
  serverDir: URL,
  table: Readonly<Record<string, string>>,
): Promise<number> {
  const files = builtin('node:fs/promises') as NodeFiles | undefined;
  const url = builtin('node:url') as NodeUrl | undefined;
  if (files === undefined || url === undefined) return 0;
  const root = url.fileURLToPath(serverDir);
  let written = 0;
  for (const entry of await files.readdir(root, { recursive: true })) {
    if (!/\.(?:m|c)?js$/u.test(entry)) continue;
    const path = `${root.replace(/[\\/]$/u, '')}/${entry}`;
    const code = await files.readFile(path, 'utf8');
    const next = writeIslandTable(code, table);
    if (next === code) continue;
    await files.writeFile(path, next);
    written += 1;
  }
  return written;
}

const VIRTUAL_OPTIONS_ID = 'virtual:payload-live-preview/options';
const RESOLVED_VIRTUAL_OPTIONS_ID = `\0${VIRTUAL_OPTIONS_ID}`;
const MIDDLEWARE_ENTRYPOINT = 'payload-live-preview/astro/middleware-entry';

/** Build the integration. The injected runtime stays inert outside the admin's preview iframe. */
export function livePreview(options: LivePreviewAstroOptions = {}): AstroIntegrationLike {
  let serverDir: URL | undefined;
  let islandTable: Readonly<Record<string, string>> | undefined;
  return {
    name: 'payload-live-preview',
    hooks: {
      'astro:config:done': ({ config }): void => {
        serverDir = config.build?.server;
      },
      'astro:build:ssr': ({ manifest }): void => {
        islandTable = islandModuleTable(manifest);
      },
      'astro:build:done': async ({ logger }): Promise<void> => {
        if (serverDir === undefined || islandTable === undefined) return;
        const written = await writeIslandModules(serverDir, islandTable);
        // No placeholder is normal: an app that renders no islands in fragments
        // never imports resolveIslandModule, and the bundler drops it.
        if (written > 0) {
          logger?.info(`island module table written into ${String(written)} server chunk(s)`);
        }
      },
      'astro:config:setup': (ctx): void => {
        if (options.mode === 'middleware') {
          setupMiddlewareMode(ctx, options);
          return;
        }
        if (options.authorizePreviewModule !== undefined) {
          throw new Error(
            "payload-live-preview: `authorizePreviewModule` applies to mode 'middleware'; " +
              'inline and loader delivery run no server hook (ADR 0024).',
          );
        }
        if (options.autoInject === false) return;
        if (options.mode === 'loader') {
          setupLoaderMode(ctx, options);
          return;
        }
        ctx.injectScript(
          'head-inline',
          generateInlineScript(inlineScriptConfig(options, ASTRO_PAGE)),
        );
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

  const asset = loaderAsset(ctx.config?.base ?? '/', options.runtime);

  ctx.injectScript(
    'head-inline',
    generateLoaderScript(inlineScriptConfig(options, ASTRO_PAGE), {
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
  const reference = options.authorizePreviewModule;
  if (reference !== undefined) refuseOutsideReference(reference);
  // Strict needs `authorizePreview`, which cannot serialize: refuse here rather
  // than build cleanly and fail on every preview request.
  const willBeStrict = options.strict ?? options.defaults !== 'v1';
  if (willBeStrict && reference === undefined) {
    throw new Error(
      "payload-live-preview: mode 'middleware' cannot satisfy the 2.0 strict default — it " +
        'serializes its options into the build, so it cannot carry the `authorizePreview` ' +
        'function strict mode requires. Name the module that exports it in ' +
        '`authorizePreviewModule` (ADR 0024), or register ' +
        '`createLivePreviewMiddleware({ authorizePreview, ... })` yourself in src/middleware.ts. ' +
        "`defaults: 'v1'` (or `strict: false`) runs intent-only middleware instead " +
        '(ADR 0006 explains why intent is not authorization).',
    );
  }

  const {
    mode: _mode,
    shouldInject: _shouldInject,
    authorizePreviewModule: _reference,
    ...serializable
  } = options;
  const json = JSON.stringify(serializable).replace(/</g, '\\u003C');
  // Vite resolves a root-relative path against the project root.
  const optionsModule =
    reference === undefined
      ? `export default ${json};`
      : [
          ...hookImportLines(reference.startsWith('./') ? reference.slice(1) : reference),
          `export default { ...${json}, authorizePreview };`,
        ].join('\n');

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
