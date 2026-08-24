/**
 * Public entry for the sveltekit adapter.
 *
 * A barrel, deliberately: the implementation lives in `./adapter` so the
 * coverage report can see it. Index files are excluded from coverage as a
 * barrel convention, and while this one held the implementation those roughly
 * two hundred lines were measured by nothing at all.
 *
 * @module @adapters/sveltekit/index
 */
export * from './adapter';
