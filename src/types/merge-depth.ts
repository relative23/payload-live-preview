/**
 * The one rule shared by the adapters, the client and the inline generator:
 * `serverURL` needs an explicit `mergeDepth` (ADR 0007, entry 10). It lives in the leaf `types` domain because the inline generator
 * is server-side code that may not reach the browser runtime in `core`, and
 * three copies of the check had already drifted in what they treated as
 * "no server" and "no depth".
 */

/**
 * The population depth is a deliberate choice. An empty `serverURL` fetches
 * nothing and owes no depth; `null` counts as omitted because the inline wire
 * config carries it.
 */
export function assertMergeDepthExplicit(options: {
  readonly serverURL?: string | undefined;
  readonly mergeDepth?: number | null | undefined;
}): void {
  if ((options.serverURL ?? '') === '' || options.mergeDepth != null) return;
  throw new Error(
    'payload-live-preview: `serverURL` needs an explicit `mergeDepth` — choose the population ' +
      'depth deliberately (0 for none; ADR 0007, entry 10).',
  );
}
