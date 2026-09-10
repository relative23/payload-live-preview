/**
 * The Nuxt module: one line in `nuxt.config.ts` instead of a hand-written
 * Nitro plugin.
 *
 * ```ts
 * export default defineNuxtConfig({
 *   modules: ['payload-live-preview/nuxt-module'],
 *   livePreview: { allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN] },
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
 * are not part of this type: a function does not survive `JSON.stringify`. A
 * preview that needs either registers `livePreviewNitroPlugin()` by hand,
 * exactly as before (docs/nuxt.md).
 */

import { join } from 'node:path';
import type { PreviewAdapterOptions } from '@adapters/shared/options';
import type { PreviewRequestLike } from '@adapters/shared/preview-request';

/** What the module accepts, from `livePreview` in `nuxt.config.ts` or from `modules: [[..., options]]`. */
export type LivePreviewModuleOptions = Omit<
  PreviewAdapterOptions<PreviewRequestLike>,
  'authorizePreview' | 'shouldInject'
>;

/** The Nitro config slice this module writes into. */
export interface NitroConfigLike {
  plugins?: string[];
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
    readonly buildDir: string;
    readonly build: { templates: NuxtTemplateLike[] };
    livePreview?: LivePreviewModuleOptions;
  };
  readonly hook: (name: 'nitro:config', handler: (config: NitroConfigLike) => void) => void;
}

/** The generated plugin's name in `.nuxt/`, distinctive enough to recognise in a build listing. @internal */
export const PLUGIN_FILENAME = 'payload-live-preview-nitro-plugin.mjs';

/**
 * The generated plugin: an import of the public adapter entry and a call with
 * the options. Nothing framework-private, so a reader who opens the file in
 * `.nuxt/` sees the hand-written setup they would otherwise have typed.
 * @internal
 */
export function pluginSource(options: LivePreviewModuleOptions): string {
  return [
    "import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';",
    '',
    `export default livePreviewNitroPlugin(${JSON.stringify(options)});`,
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
  nuxt.options.build.templates.push({
    filename: PLUGIN_FILENAME,
    // Nitro reads the plugin from disk, not from Nuxt's virtual file system.
    write: true,
    getContents: () => pluginSource(options),
  });
  const plugin = join(nuxt.options.buildDir, PLUGIN_FILENAME);
  nuxt.hook('nitro:config', (config) => {
    const plugins = (config.plugins ??= []);
    // Nuxt re-runs modules on a config reload; registering twice would inject
    // the runtime twice into every page.
    if (!plugins.includes(plugin)) plugins.push(plugin);
  });
}

/** Nuxt reads this off the module function to name it in build output and errors. */
livePreviewModule.meta = {
  name: 'payload-live-preview',
  configKey: 'livePreview',
};
