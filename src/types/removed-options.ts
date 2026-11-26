/**
 * The options 3.0 removed from the adapters and the inline generator. Their types have no place
 * for them, but a JavaScript config can still pass one. It is refused at startup, with the codemod
 * that rewrites it, because ignoring it would run the page with other rows than the ones the
 * project asked for (ADR 0007).
 */

/** Throws for an option that 3.0 removed; `options` is whatever the caller was handed. */
export function refuseRemovedOptions(options: object): void {
  const given: { readonly onUnboundChange?: unknown } = options;
  if (given.onUnboundChange !== undefined) {
    throw new Error(
      'payload-live-preview: `onUnboundChange` was removed in 3.0. Name it `onUnfaithfulPatch`, ' +
        "where 'route' is 'escalate'; `pll migrate` renames it (ADR 0007, row 19).",
    );
  }
}
