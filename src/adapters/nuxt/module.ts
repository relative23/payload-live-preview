/**
 * The Nuxt module: one line in `nuxt.config.ts` instead of a hand-written
 * Nitro plugin.
 *
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ['payload-live-preview/nuxt-module'],
 *   livePreview: {
 *     // The hook travels by reference (ADR 0024); the strict default holds.
 *     authorizePreviewModule: './server/utils/live-preview-auth',
 *     allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
 *   },
 * });
 * ```
 *
 * A Nuxt module is a plain function of `(inlineOptions, nuxt)`; `defineNuxtModule`
 * from `@nuxt/kit` is sugar around exactly that. Writing the function keeps
 * `@nuxt/kit` out of the dependency list — this package adapts Nuxt, it does not
 * build with it — and keeps the module readable as the two things it does:
 * take the options, and register a Nitro plugin written from them.
 *
 * The plugin is generated rather than shipped. The module runs at build time and
 * the plugin runs per request in Nitro's own bundle, so the options cannot travel
 * as a closure — they have to be written as source. Nuxt already has the
 * mechanism: a build template, written into `.nuxt/` and registered by its path,
 * which is what `resolveNitroPath` wants (it resolves a plugin entry against
 * `srcDir`, so a bare specifier would be looked for under `server/`).
 *
 * That the options are serialized is why `authorizePreview` and `shouldInject`
 * are not part of this type: a function does not survive `JSON.stringify`.
 * The hook travels by reference instead (ADR 0024): `authorizePreviewModule`
 * names a server module whose default export it is, and the plugin imports
 * it. With a reference the module also registers the server handler, so the
 * decision is made before the app renders and a page can read it on
 * `event.context`. Without it the strict 2.0 default throws when Nitro loads the plugin;
 * `defaults: 'v1'` (or `strict: false`) injects on client-controlled intent
 * alone. A preview that needs `shouldInject` registers
 * `livePreviewNitroPlugin()` by hand, exactly as before (docs/nuxt.md).
 */

import { statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { hookImportLines, refuseOutsideReference } from '@adapters/shared/hook-reference';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PreviewRequestLike } from '@adapters/shared/preview-request';

/** What the module accepts, from `livePreview` in `nuxt.config.ts` or from `modules: [[..., options]]`. */
export type LivePreviewModuleOptions = Omit<
  PreviewAdapterOptions<PreviewRequestLike>,
  'authorizePreview' | 'shouldInject'
> & {
  /**
   * A server module whose default export is the `authorizePreview` hook, so
   * the strict default holds (ADR 0024). A path beginning with `./` is
   * relative to the project root and an alias such as `~/` is Nuxt's own; the
   * module names the file either one points at, with its extension. A package
   * specifier is passed to Nitro unchanged.
   */
  readonly authorizePreviewModule?: string;
};

/** The Nitro config slice this module writes into. */
export interface NitroConfigLike {
  plugins?: string[];
  /** Server handlers; the module adds its own as middleware when a hook is referenced. */
  handlers?: { readonly middleware?: boolean; readonly handler: string }[];
}

/** The one build template shape this module adds; Nuxt writes it to `buildDir/filename`. */
export interface NuxtTemplateLike {
  readonly filename: string;
  readonly write: boolean;
  readonly getContents: () => string;
}

/**
 * The two config slots and the one hook this module touches, duck-typed. Nuxt's
 * own types would mean a build-time dependency on `nuxt` for everyone who
 * installs this package.
 */
export interface NuxtLike {
  readonly options: {
    readonly rootDir: string;
    readonly buildDir: string;
    readonly build: { templates: NuxtTemplateLike[] };
    /** Nuxt's aliases (`~`, `~~`, `@`, …) to their directories. */
    readonly alias?: Readonly<Record<string, string>>;
    livePreview?: LivePreviewModuleOptions;
  };
  readonly hook: (name: 'nitro:config', handler: (config: NitroConfigLike) => void) => void;
}

/** The generated plugin's name in `.nuxt/`, distinctive enough to recognise in a build listing. @internal */
export const PLUGIN_FILENAME = 'payload-live-preview-nitro-plugin.mjs';
/** The generated server handler's name, written beside the plugin when a hook is referenced. @internal */
export const HANDLER_FILENAME = 'payload-live-preview-server-handler.mjs';

const EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.cts', '.cjs'] as const;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The file a path names: itself, then with an extension, then a directory's index. */
function findFile(path: string): string | undefined {
  if (isFile(path)) return path;
  for (const extension of EXTENSIONS) if (isFile(path + extension)) return path + extension;
  for (const extension of EXTENSIONS) {
    const index = join(path, `index${extension}`);
    if (isFile(index)) return index;
  }
  return undefined;
}

/** Where a project-relative or aliased reference points, before any extension is added. */
function projectPath(
  reference: string,
  rootDir: string,
  alias: Readonly<Record<string, string>>,
): string | undefined {
  // The files are written into the build directory, so a project-relative path is made absolute.
  if (reference.startsWith('./')) return join(rootDir, reference);
  const aliases = Object.keys(alias).sort((left, right) => right.length - left.length);
  const key = aliases.find((name) => reference === name || reference.startsWith(`${name}/`));
  return key === undefined ? undefined : join(alias[key] ?? '', reference.slice(key.length));
}

/**
 * The module the generated files import. `nuxt dev` imports them without
 * bundling and nothing there adds an extension to a bare path, so a reference
 * to a TypeScript file answered 500 in development while the production build
 * resolved it. Where the file can be read, its own name is written. Where it
 * cannot, the reference stays as the bundler will see it: absolute for a
 * project path, as written for an alias or a package.
 */
function resolveReference(
  reference: string,
  rootDir: string,
  alias: Readonly<Record<string, string>>,
): string {
  const path = projectPath(reference, rootDir, alias);
  if (path === undefined) return reference;
  return findFile(path) ?? (reference.startsWith('./') ? path : reference);
}

/**
 * What both generated files pass on: the options as a literal and, when a
 * hook is referenced, its import and the argument that carries it.
 */
function generatedParts(
  options: LivePreviewModuleOptions,
  rootDir: string,
  alias: Readonly<Record<string, string>>,
): { readonly hook: string[]; readonly argument: string } {
  const { authorizePreviewModule: reference, ...serializable } = options;
  const json = JSON.stringify(serializable);
  if (reference === undefined) return { hook: [], argument: json };
  refuseOutsideReference(reference);
  return {
    hook: hookImportLines(resolveReference(reference, rootDir, alias)),
    argument: `{ ...${json}, authorizePreview }`,
  };
}

/**
 * The generated plugin: an import of the public adapter entry and a call with
 * the options. Nothing framework-private, so a reader who opens the file in
 * `.nuxt/` sees the hand-written setup they would otherwise have typed.
 * @internal
 */
export function pluginSource(
  options: LivePreviewModuleOptions,
  rootDir: string,
  alias: Readonly<Record<string, string>> = {},
): string {
  const { hook, argument } = generatedParts(options, rootDir, alias);
  return [
    "import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';",
    ...hook,
    '',
    `export default livePreviewNitroPlugin(${argument});`,
    '',
  ].join('\n');
}

/**
 * The generated server handler, as docs/nuxt.md writes it by hand: it decides
 * before the app renders, so a page can read the verdict on `event.context`
 * for its bindings and its draft read, and the plugin reuses that verdict.
 */
function handlerSource(
  options: LivePreviewModuleOptions,
  rootDir: string,
  alias: Readonly<Record<string, string>>,
): string {
  const { hook, argument } = generatedParts(options, rootDir, alias);
  return [
    "import { defineEventHandler } from 'h3';",
    "import { defineLivePreviewServerHandler } from 'payload-live-preview/nuxt';",
    ...hook,
    '',
    `export default defineEventHandler(defineLivePreviewServerHandler(${argument}));`,
    '',
  ].join('\n');
}

/**
 * The module itself. Options come from `livePreview` in the Nuxt config, from
 * the module's own inline options, or from both — the inline ones win, because
 * they are the more specific place to write them.
 */
export default function livePreviewModule(
  inlineOptions: LivePreviewModuleOptions | undefined,
  nuxt: NuxtLike,
): void {
  const options: LivePreviewModuleOptions = {
    ...(nuxt.options.livePreview ?? {}),
    ...(inlineOptions ?? {}),
  };
  // Refused at setup, not later when Nuxt writes the template.
  if (options.authorizePreviewModule !== undefined) {
    refuseOutsideReference(options.authorizePreviewModule);
  }
  nuxt.options.build.templates.push({
    filename: PLUGIN_FILENAME,
    // Nitro reads the plugin from disk, not from Nuxt's virtual file system.
    write: true,
    getContents: () => pluginSource(options, nuxt.options.rootDir, nuxt.options.alias),
  });
  const plugin = join(nuxt.options.buildDir, PLUGIN_FILENAME);
  // Only a referenced hook makes a decision a page can read before it renders;
  // the intent-only setup keeps the plugin alone, as before.
  const decides = options.authorizePreviewModule !== undefined;
  if (decides) {
    nuxt.options.build.templates.push({
      filename: HANDLER_FILENAME,
      write: true,
      getContents: () => handlerSource(options, nuxt.options.rootDir, nuxt.options.alias ?? {}),
    });
  }
  const handler = join(nuxt.options.buildDir, HANDLER_FILENAME);
  nuxt.hook('nitro:config', (config) => {
    const plugins = (config.plugins ??= []);
    // Nuxt re-runs modules on a config reload; registering twice would inject
    // the runtime twice into every page.
    if (!plugins.includes(plugin)) plugins.push(plugin);
    if (!decides) return;
    const handlers = (config.handlers ??= []);
    if (!handlers.some((entry) => entry.handler === handler)) {
      handlers.push({ middleware: true, handler });
    }
  });
}

/** Nuxt reads this off the module function to name it in build output and errors. */
livePreviewModule.meta = {
  name: 'payload-live-preview',
  configKey: 'livePreview',
};

/**
 * How `@nuxt/kit`'s `installModule` actually reads that meta — `.meta` alone
 * names nothing to it. Through this Nuxt also writes the `livePreview` key
 * into `.nuxt/types/schema.d.ts`; without it `nuxt.config.ts` fails to
 * type-check on that key.
 */
livePreviewModule.getMeta = (): Promise<typeof livePreviewModule.meta> =>
  Promise.resolve(livePreviewModule.meta);

/**
 * The app's own `@vitejs/plugin-vue` default export, as far as it is called
 * here: with the hook that names a component's scope id.
 */
export type VuePluginFactory = (options?: {
  readonly features?: {
    readonly componentIdGenerator?: (
      filepath: string,
      source: string,
      isProduction: boolean | undefined,
      getHash: (text: string) => string,
    ) => string;
  };
}) => { readonly name: string };

const EMPTY_STYLE = '\0payload-live-preview:server-style';

/**
 * The rollup plugins Nitro needs to render the project's single-file
 * components in a fragment endpoint (ADR 0030), for
 * `nitro.rollupConfig.plugins`: Vue's plugin, hashing a scope id from the path
 * under `srcDir` as Nuxt's own build does, and an empty module for every style
 * request, which the page's build delivers instead (ADR 0029).
 *
 * Without the second, rollup fails on a component's `<style>`. Without the
 * first, Nuxt 4's `app/` layout gives the fragment other scope ids than the
 * page, and no scoped rule reaches what it renders.
 */
export function fragmentComponentPlugins(
  vue: VuePluginFactory,
  options: { readonly srcDir: string },
): { readonly name: string }[] {
  // plugin-vue outside Vite resolves paths from the working directory.
  const root = process.cwd();
  const componentIdGenerator = (
    filepath: string,
    source: string,
    isProduction: boolean | undefined,
    getHash: (text: string) => string,
  ): string => {
    const underSrcDir = relative(options.srcDir, resolve(root, filepath)).replaceAll('\\', '/');
    return getHash(underSrcDir + (isProduction === true ? source : ''));
  };
  const styles = {
    name: 'payload-live-preview:server-styles',
    resolveId: (id: string): string | null => (/[?&]type=style\b/u.test(id) ? EMPTY_STYLE : null),
    load: (id: string): string | null => (id === EMPTY_STYLE ? 'export default ""' : null),
  };
  return [styles, vue({ features: { componentIdGenerator } })];
}
