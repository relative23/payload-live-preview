/**
 * Astro integration: regenerate the types on startup and, during `astro dev`,
 * whenever anything next to the Payload config changes. Paths are relative to
 * Astro's root. Uses `fs.watch`; no watcher dependency.
 */
import { watch, type FSWatcher } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTypes } from './index';

export interface AstroCodegenOptions {
  /** Path to `payload.config.ts` (absolute or relative to Astro's root). */
  readonly configPath: string;
  /** Output path for generated types (absolute or relative to Astro's root). */
  readonly outPath: string;
  /** Re-run when the config or anything beside it changes during `astro dev`. Default `true`. */
  readonly watch?: boolean;
  /** Only log errors. Default `false`. */
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
      readonly config?: { readonly root?: URL | string };
    }) => Promise<void> | void;
    readonly 'astro:server:start'?: () => void;
    readonly 'astro:build:start'?: () => Promise<void> | void;
  }>;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json']);
const DEBOUNCE_MS = 100;

function rootOf(root: URL | string | undefined): string {
  if (root === undefined) return process.cwd();
  if (root instanceof URL) return fileURLToPath(root);
  return root.startsWith('file:') ? fileURLToPath(root) : root;
}

export function livePreviewCodegen(options: AstroCodegenOptions): AstroIntegration {
  const watchEnabled = options.watch ?? true;
  let root = process.cwd();
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
        cwd: root,
      });
      if (result.outFile === undefined) {
        logger?.error(`pll-codegen: nothing written — ${result.diagnostics.join(' ')}`);
      } else if (options.quiet !== true) {
        logger?.info(
          `pll-codegen: ${String(result.schema.globals.length)} globals, ${String(result.schema.collections.length)} collections → ${options.outPath}`,
        );
        for (const diagnostic of result.diagnostics) logger?.warn(`pll-codegen: ${diagnostic}`);
      }
    } catch (error) {
      logger?.error(
        `pll-codegen failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      active = false;
      if (queued) {
        queued = false;
        void regenerate(logger);
      }
    }
  }

  function startWatching(logger: AstroLogger | undefined): void {
    const directory = dirname(resolve(root, options.configPath));
    const outPath = resolve(root, options.outPath);
    try {
      // The output file may live under the watched directory; writing it must not retrigger.
      watcher = watch(directory, { recursive: true }, (_event, file) => {
        if (file === null) return;
        const changed = resolve(directory, file);
        if (changed === outPath || changed.includes(`${sep}node_modules${sep}`)) return;
        if (!SOURCE_EXTENSIONS.has(extname(changed))) return;
        clearTimeout(timer);
        timer = setTimeout(() => void regenerate(logger), DEBOUNCE_MS);
      });
    } catch (error) {
      logger?.warn(
        `pll-codegen watcher unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    name: 'payload-live-preview:codegen',
    hooks: {
      'astro:config:setup': async ({ command, logger, config }) => {
        root = rootOf(config?.root);
        await regenerate(logger);
        if (watchEnabled && command === 'dev') startWatching(logger);
      },
      'astro:server:start': () => undefined,
      'astro:build:start': () => {
        clearTimeout(timer);
        watcher?.close();
        watcher = undefined;
      },
    },
  };
}
