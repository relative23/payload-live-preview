/**
 * The one rule shared by the adapters, the client and the inline generator:
 * `serverURL` needs an explicit `mergeDepth` under the 2.0 defaults (ADR 0007,
 * entry 10). It lives in the leaf `types` domain because the inline generator
 * is server-side code that may not reach the browser runtime in `core`, and
 * three copies of the check had already drifted in what they treated as
 * "no server" and "no depth".
 */

import type { DefaultsProfile } from '@core/defaults-profile';

/**
 * The population depth is a deliberate choice; the 1.x default of 1 stays only
 * behind `defaults: 'v1'`. An empty `serverURL` fetches nothing and owes no
 * depth; `null` counts as omitted because the inline wire config carries it.
 */
export function assertMergeDepthExplicit(options: {
  readonly defaults?: DefaultsProfile | undefined;
  readonly serverURL?: string | undefined;
  readonly mergeDepth?: number | null | undefined;
}): void {
  if (options.defaults === 'v1') return;
  if ((options.serverURL ?? '') === '' || options.mergeDepth != null) return;
  throw new Error(
    'payload-live-preview: `serverURL` needs an explicit `mergeDepth` under the 2.0 defaults — ' +
      "choose the population depth deliberately (0 for none), or pass `defaults: 'v1'` to keep " +
      'the 1.x default of 1 while migrating (ADR 0007, entry 10).',
  );
}
