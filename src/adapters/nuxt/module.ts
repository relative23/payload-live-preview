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
 * build with it — and keeps the module readable as the things it does: take the
 * options, register a Nitro plugin written from them, and register the client
 * plugin that tells the runtime about client navigations (since 2.4; before,
 * docs/nuxt.md had the project copy it).
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
 * `event.context`. Without it the plugin throws when Nitro loads it: since 3.0
 * no response changes on intent alone. A preview that needs `shouldInject`
 * registers `livePreviewNitroPlugin()` by hand (docs/nuxt.md).
 */

import { join, relative, resolve } from 'node:path';
import { refuseOutsideReference } from '@adapters/shared/hook-reference';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PreviewRequestLike } from '@adapters/shared/preview-request';
import { warnOnce } from '@/types/dev-warning';
import {
  EXTENSIONS,
  HANDLER_FILENAME,
  PLUGIN_FILENAME,
  handlerSource,
  isFile,
  pluginSource,
  requireProjectRoot,
} from './module-sources';

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
  /**
   * Whether the module registers its client plugin for client navigations and
   * route refreshes (`payload-live-preview/nuxt/client`). On by default; a
   * project that still has the plugin docs/nuxt.md had it copy before 2.4
   * keeps its own, and the module registers nothing beside it.
   */
  readonly navigation?: boolean;
};

/** The Nitro config slice this module writes into. */
export interface NitroConfigLike {
  plugins?: string[];
  /** Server handlers; the module adds its own as middleware when a hook is referenced. */
  handlers?: { readonly middleware?: boolean; readonly handler: string }[];
}

/** A Nuxt plugin entry as `nuxt.options.plugins` holds it. */
export interface NuxtPluginLike {
  /** The plugin file; the module's own is written into `buildDir`. */
  readonly src: string;
  /** Where the plugin runs; the module's own runs only in the browser. */
  readonly mode?: 'client' | 'server' | 'all';
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
    /** Required when authorizePreviewModule names a server hook. */
    readonly rootDir?: string;
    /** Where the app's `plugins/` directory is; `app/` under Nuxt 4. */
    readonly srcDir?: string;
    readonly buildDir: string;
    readonly build: { templates: NuxtTemplateLike[] };
    /** The app plugins; the module adds its client plugin here. */
    plugins?: (NuxtPluginLike | string)[];
    /** Nuxt's aliases (`~`, `~~`, `@`, …) to their directories. */
    readonly alias?: Readonly<Record<string, string>>;
    livePreview?: LivePreviewModuleOptions;
  };
  readonly hook: (name: 'nitro:config', handler: (config: NitroConfigLike) => void) => void;
}

/** The generated client plugin's name in `.nuxt/`. */
const NAVIGATION_PLUGIN_FILENAME = 'payload-live-preview-navigation.client.mjs';

/** The file docs/nuxt.md had a project create before 2.4, under `srcDir/plugins/`. */
const RECIPE_PLUGIN = 'payload-live-preview-navigation.client';

/**
 * The generated client plugin. Nuxt's composables come from `#app`, which
 * only a Nuxt build resolves, so the plugin imports them and hands them to the
 * package; the cleanup also goes to hot replacement, which reloads it.
 */
function navigationPluginSource(): string {
  return [
    "import { defineNuxtPlugin, refreshNuxtData } from '#app';",
    "import { bindNuxtNavigation } from 'payload-live-preview/nuxt/client';",
    '',
    'export default defineNuxtPlugin({',
    "  name: 'payload-live-preview:navigation',",
    '  setup(nuxtApp) {',
    '    const cleanup = bindNuxtNavigation(nuxtApp, refreshNuxtData);',
    '    import.meta.hot?.dispose(cleanup);',
    '  },',
    '});',
    '',
  ].join('\n');
}

/** The recipe plugin a project still carries, if any: registering a second would dispatch twice. */
function recipePlugin(srcDir: string | undefined): string | undefined {
  if (srcDir === undefined) return undefined;
  for (const extension of EXTENSIONS) {
    const path = join(srcDir, 'plugins', RECIPE_PLUGIN + extension);
    if (isFile(path)) return path;
  }
  return undefined;
}

/** Register the client plugin unless the options switch it off or the project has its own. */
function registerNavigationPlugin(nuxt: NuxtLike, options: LivePreviewModuleOptions): void {
  if (options.navigation === false) return;
  const own = recipePlugin(nuxt.options.srcDir);
  if (own !== undefined) {
    warnOnce(
      'nuxt-navigation-recipe',
      `${relative(nuxt.options.rootDir ?? process.cwd(), own)} does what the module's own client ` +
        'plugin does since 2.4, so the module leaves it in charge. Delete the file to use the ' +
        'packaged one, or set `livePreview: { navigation: false }` to keep yours and silence this.',
    );
    return;
  }
  nuxt.options.build.templates.push({
    filename: NAVIGATION_PLUGIN_FILENAME,
    write: true,
    getContents: navigationPluginSource,
  });
  const src = join(nuxt.options.buildDir, NAVIGATION_PLUGIN_FILENAME);
  const plugins = (nuxt.options.plugins ??= []);
  // A config reload runs the module again.
  if (!plugins.some((entry) => (typeof entry === 'string' ? entry : entry.src) === src)) {
    plugins.push({ src, mode: 'client' });
  }
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
    requireProjectRoot(nuxt.options.rootDir);
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
  registerNavigationPlugin(nuxt, options);
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
