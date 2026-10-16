/**
 * The path this app is served under, empty at the site root. `next.config.mjs`
 * hands it to Next as `basePath`; the fixture's own redirects, iframe sources,
 * fragment endpoint and asset path add it themselves, as an app under a base
 * path has to: the runtime requests exactly the paths it is given.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
