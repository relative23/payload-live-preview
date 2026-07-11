/**
 * Astro integration — regenerates the types file on dev-server start
 * and (optionally) watches `payload.config.ts` for changes.
 *
 *   ```ts
 *   // astro.config.mjs
 *   import { livePreviewCodegen } from '@relative23/payload-live-preview/codegen';
 *
 *   export default defineConfig({
 *     integrations: [
 *       livePreviewCodegen({
 *         configPath: '../backend/src/payload.config.ts',
 *         outPath: 'src/payload-types.ts',
 *         watch: true,
 *       }),
 *     ],
 *   });
 *   ```
 *
 * The plugin uses Node's `fs.watch` (no chokidar dependency) — Astro
 * already bundles enough watch-mode tooling that we don't need a
 * full-fat library here.
 *
 * @module @codegen/astro-plugin
 */

import { watch } from 'node:fs';
import { generateTypes } from './index';

export interface AstroCodegenOptions {
  /** Path to `payload.config.ts` (absolute or relative to Astro's root). */
  readonly configPath: string;
  /** Output path for generated types (absolute or relative to Astro's root). */
  readonly outPath: string;
  /** Re-run on `payload.config.ts` changes during `astro dev`. Default `true`. */
  readonly watch?: boolean;
  /** Quiet mode — only error logging. Default `false`. */
  readonly quiet?: boolean;
}

interface AstroLogger {
  readonly info: (msg: string) => void;
  readonly warn: (msg: string) => void;
  readonly error: (msg: string) => void;
}

interface AstroIntegration {
  readonly name: string;
  readonly hooks: Readonly<{
    readonly 'astro:config:setup'?: (params: {
      readonly command: string;
      readonly logger?: AstroLogger;
    }) => Promise<void> | void;
    readonly 'astro:server:start'?: () => void;
    readonly 'astro:build:start'?: () => Promise<void> | void;
  }>;
}

export function livePreviewCodegen(options: AstroCodegenOptions): AstroIntegration {
  const watchEnabled = options.watch ?? true;
  let watcher: ReturnType<typeof watch> | undefined;
  let active = false;
  let queued = false;

  async function regenerate(logger: AstroLogger | undefined): Promise<void> {
    if (active) {
      queued = true;
      return;
    }
    active = true;
    try {
      const result = await generateTypes({
        configPath: options.configPath,
        outFile: options.outPath,
      });
      if (!options.quiet) {
        logger?.info(
          `pll-codegen: ${result.schema.globals.length} globals, ${result.schema.collections.length} collections → ${options.outPath}`,
        );
        for (const diagnostic of result.diagnostics) {
          logger?.warn(`pll-codegen: ${diagnostic}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger?.error(`pll-codegen failed: ${message}`);
    } finally {
      active = false;
      if (queued) {
        queued = false;
        void regenerate(logger);
      }
    }
  }

  return {
    name: '@relative23/payload-live-preview:codegen',
    hooks: {
      'astro:config:setup': async ({ command, logger }) => {
        await regenerate(logger);
        if (watchEnabled && command === 'dev') {
          try {
            watcher = watch(options.configPath, () => {
              void regenerate(logger);
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger?.warn(`pll-codegen watcher unavailable: ${message}`);
          }
        }
      },
      'astro:server:start': () => {
        // No-op — watcher was set up during config:setup. Hook kept so
        // future versions can react to dev-server lifecycle events.
      },
      'astro:build:start': () => {
        watcher?.close();
        watcher = undefined;
      },
    },
  };
}
