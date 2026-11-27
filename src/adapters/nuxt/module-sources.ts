/**
 * The two server files the Nuxt module writes into `.nuxt/`: the Nitro plugin
 * and, where a hook is referenced, the server handler. They are generated
 * because the module runs at build time and the files run per request, so the
 * options travel as source and the hook as an import (ADR 0024). Apart from
 * the module, so that its entry exports the module and its types alone.
 */

import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { hookImportLines, refuseOutsideReference } from '@adapters/shared/hook-reference';
import type { LivePreviewModuleOptions } from './module';

/** The generated plugin's name in `.nuxt/`, distinctive enough to recognise in a build listing. */
export const PLUGIN_FILENAME = 'payload-live-preview-nitro-plugin.mjs';
/** The generated server handler's name, written beside the plugin when a hook is referenced. */
export const HANDLER_FILENAME = 'payload-live-preview-server-handler.mjs';

export const EXTENSIONS = ['.ts', '.mts', '.js', '.mjs', '.cts', '.cjs'] as const;

/** A new hook reference must never silently resolve from this process's working directory. */
export function requireProjectRoot(rootDir: string | undefined): string {
  if (typeof rootDir !== 'string' || !isAbsolute(rootDir)) {
    throw new Error(
      'payload-live-preview: authorizePreviewModule requires an absolute project root; ' +
        'pass Nuxt options.rootDir, or the rootDir argument to pluginSource().',
    );
  }
  return rootDir;
}

export function isFile(path: string): boolean {
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
  rootDir: string | undefined,
  alias: Readonly<Record<string, string>>,
): { readonly hook: string[]; readonly argument: string } {
  // `navigation` is the module's own switch; the Nitro adapter does not take it.
  const { authorizePreviewModule: reference, navigation: _navigation, ...serializable } = options;
  const json = JSON.stringify(serializable);
  if (reference === undefined) return { hook: [], argument: json };
  refuseOutsideReference(reference);
  return {
    hook: hookImportLines(resolveReference(reference, requireProjectRoot(rootDir), alias)),
    argument: `{ ...${json}, authorizePreview }`,
  };
}

/**
 * The generated plugin: an import of the public adapter entry and a call with
 * the options. Nothing framework-private, so a reader who opens the file in
 * `.nuxt/` sees the hand-written setup they would otherwise have typed.
 */
export function pluginSource(
  options: LivePreviewModuleOptions,
  rootDir?: string,
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
export function handlerSource(
  options: LivePreviewModuleOptions,
  rootDir: string | undefined,
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
