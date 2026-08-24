/**
 * Public entry for the nuxt adapter.
 *
 * A barrel, deliberately: the implementation lives in `./adapter` so the
 * coverage report can see it. Index files are excluded from coverage as a
 * barrel convention, and while this one held the implementation those roughly
 * two hundred lines were measured by nothing at all.
 *
 * @module @adapters/nuxt/index
 */
export * from './adapter';
