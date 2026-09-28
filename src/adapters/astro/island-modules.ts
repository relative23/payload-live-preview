/**
 * The client module URLs this Astro build produced, for a container that
 * renders framework islands in fragments (ADR 0021). The integration writes
 * the table over the placeholder once the client build is known; a request
 * can never choose a module, and an unknown specifier fails closed.
 */

/** Specifier Astro asks about → public URL the build emitted for it. */
export type IslandModuleTable = Readonly<Record<string, string>>;

/** Resolves an island's component, renderer and before-hydration specifiers. */
export type IslandModuleResolver = (specifier: string) => Promise<string>;

const MISSING_TABLE =
  'payload-live-preview: this server build carries no island module table. Add livePreview() ' +
  "from 'payload-live-preview/astro' to the Astro integrations and run `astro build`; " +
  '`astro dev` and a server build that does not bundle payload-live-preview are not supported ' +
  '(ADR 0021).';

function isIslandModuleTable(value: unknown): value is IslandModuleTable {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((url) => typeof url === 'string')
  );
}

/**
 * A resolver over one table. Astro calls it for the component, the client
 * renderer and `astro:scripts/before-hydration.js`, and treats an empty string
 * as "no before-hydration script", as its own production pipeline does. @internal
 */
export function createIslandModuleResolver(table: unknown): IslandModuleResolver {
  const modules = new Map<string, string>(isIslandModuleTable(table) ? Object.entries(table) : []);
  const complete = isIslandModuleTable(table);
  return (specifier) => {
    if (!complete) return Promise.reject(new Error(MISSING_TABLE));
    const url = modules.get(specifier);
    if (url === undefined) {
      return Promise.reject(
        new Error(
          `payload-live-preview: the build emitted no client module for island specifier "${specifier}"; ` +
            'the island is not rendered rather than pointed at a source file.',
        ),
      );
    }
    return Promise.resolve(url);
  };
}

/**
 * The table arrives as a JSON string written over the placeholder. Parsing at
 * run time keeps a minifier from folding the unfilled placeholder away, which
 * a plain literal did in this package's own build.
 */
function readTable(encoded: string): unknown {
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Pass as the container's `resolve`, next to the framework's server and client
 * renderers: `AstroContainer.create({ resolve: resolveIslandModule })`.
 * Needs Astro 4.16 or later, whose container accepts `resolve`.
 */
export const resolveIslandModule: IslandModuleResolver = createIslandModuleResolver(
  readTable('@@PAYLOAD_LIVE_PREVIEW_ISLAND_MODULES@@'),
);
