/**
 * The options 3.0 removed from the adapters and the inline generator. Their types have no place
 * for them, but a JavaScript config can still pass one. It is refused at startup, with the codemod
 * that rewrites it, because ignoring it would run the page with other rows than the ones the
 * project asked for (ADR 0007).
 */

/**
 * The removed profile, on its own: it is the one removed option the browser client took too, and
 * the client's bundle should carry this sentence and not the adapters' two.
 */
export function refuseRemovedProfile(options: object): void {
  const given: { readonly defaults?: unknown } = options;
  if (given.defaults === 'v1') {
    throw new Error(
      "payload-live-preview: `defaults: 'v1'` was removed in 3.0. `pll migrate` writes the 1.x " +
        "rows it stood for into your options. Two cannot be kept: `strict: false` and 'referer' " +
        'among the preview signals (ADR 0007, row 21).',
    );
  }
}

/** Throws for an option that 3.0 removed; `options` is whatever the caller was handed. */
export function refuseRemovedOptions(options: object): void {
  refuseRemovedProfile(options);
  const given: { readonly onUnboundChange?: unknown; readonly strict?: unknown } = options;
  if (given.strict === false) {
    throw new Error(
      'payload-live-preview: `strict: false` was removed in 3.0; remove the option. An adapter ' +
        'that changes a response for a request needs `authorizePreview`, a hook that returns ' +
        '`authorizePreviewRequest(request, strategy)` (docs/authorization.md; ADR 0007, row 36).',
    );
  }
  if (given.onUnboundChange !== undefined) {
    throw new Error(
      'payload-live-preview: `onUnboundChange` was removed in 3.0. Name it `onUnfaithfulPatch`, ' +
        "where 'route' is 'escalate'; `pll migrate` renames it (ADR 0007, row 19).",
    );
  }
}
