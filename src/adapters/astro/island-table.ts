/**
 * The build-time half of ADR 0021: turn the `astro:build:ssr` manifest's
 * client entry modules into the public URLs Astro's production pipeline links,
 * and write that table over the placeholder in the server output. Pure string
 * work; the integration does the file access, at build time only.
 */

/** The fields of Astro's serialized SSR manifest this reads. */
export interface SerializedManifestLike {
  readonly entryModules?: Readonly<Record<string, string>>;
  readonly base?: string;
  readonly assetsPrefix?: string | Readonly<Record<string, string>>;
}

// A copy of this constant bundled into a server chunk would be replaced too,
// harmlessly: the integration runs in astro.config, never in the server build.
const PLACEHOLDER = '@@PAYLOAD_LIVE_PREVIEW_ISLAND_MODULES@@';

function placeholderPattern(): RegExp {
  return new RegExp(`(['"\`])${PLACEHOLDER}\\1`, 'g');
}

// The helpers below mirror @astrojs/internal-helpers/path, which Astro's
// createAssetLink uses; the table must link exactly as the page does.
function trimTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function trimLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

/** `joinPaths(first, last)`: Astro's variadic helper for the two segments linking uses. */
function joinPaths(first: string | undefined, last: string): string {
  return first === undefined
    ? trimTrailingSlash(last)
    : `${trimTrailingSlash(first)}/${trimLeadingSlash(last)}`;
}

function prependSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function extensionOf(path: string): string {
  const extension = path.split('.').pop() ?? '';
  return extension === path ? '' : extension;
}

/** Astro's `createAssetLink` for an entry module, without query parameters. @internal */
export function islandModuleUrl(
  href: string,
  base: string | undefined,
  assetsPrefix: SerializedManifestLike['assetsPrefix'],
): string {
  if (href.length === 0 || href.startsWith('data:')) return href;
  const parsed = new URL(href, 'https://astro.build');
  const pathname =
    !URL.canParse(href) && !href.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  const suffix = `${parsed.search}${parsed.hash}`;
  const path = pathname.replace(/\\/g, '/');
  if (assetsPrefix !== undefined && assetsPrefix !== '') {
    let prefix: string | undefined = typeof assetsPrefix === 'string' ? assetsPrefix : undefined;
    if (typeof assetsPrefix !== 'string') {
      // Astro falls back on an empty per-extension prefix too, not only a missing one.
      const own = assetsPrefix[extensionOf(pathname)];
      prefix = own !== undefined && own !== '' ? own : assetsPrefix['fallback'];
    }
    return joinPaths(prefix, path) + suffix;
  }
  if (base !== undefined && base !== '') return prependSlash(joinPaths(base, path)) + suffix;
  return href;
}

/** The table the resolver serves, or `undefined` when the manifest lists no entry modules. @internal */
export function islandModuleTable(
  manifest: SerializedManifestLike,
): Record<string, string> | undefined {
  if (manifest.entryModules === undefined) return undefined;
  const table: Record<string, string> = {};
  for (const [specifier, file] of Object.entries(manifest.entryModules)) {
    table[specifier] = islandModuleUrl(file, manifest.base, manifest.assetsPrefix);
  }
  return table;
}

/** Whether a server chunk carries the resolver's unfilled table. @internal */
export function hasIslandTablePlaceholder(code: string): boolean {
  return placeholderPattern().test(code);
}

/** Write the table, as a JSON string literal, over every quoted placeholder in a server chunk. @internal */
export function writeIslandTable(code: string, table: Readonly<Record<string, string>>): string {
  return code.replace(placeholderPattern(), () => JSON.stringify(JSON.stringify(table)));
}
