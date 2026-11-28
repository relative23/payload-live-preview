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

/** The switches 3.0 names by what they turn on, under their 2.x names (ADR 0007, row 38). */
const TURNED_SWITCHES = [
  ['disableVisibilityGate', 'enableVisibilityGate'],
  ['disableReferrerDetection', 'enableReferrerDetection'],
  ['disableLocalhostMatching', 'enableLocalhostMatching'],
] as const;

/**
 * A switch under its 2.x name. The client takes these too, and the value would be lost without
 * a word: `disableReferrerDetection: false` asked for the referrer, the new name is not set.
 */
export function refuseTurnedSwitches(options: object): void {
  const given = options as Readonly<Record<string, unknown>>;
  for (const [before, now] of TURNED_SWITCHES) {
    if (given[before] === undefined) continue;
    throw new Error(
      `payload-live-preview: \`${before}\` was removed in 3.0. Name it \`${now}\`, with the ` +
        'value turned round; `pll migrate` rewrites a literal (ADR 0007, row 38).',
    );
  }
}

/** Throws for an option that 3.0 removed; `options` is whatever the caller was handed. */
export function refuseRemovedOptions(options: object): void {
  refuseRemovedProfile(options);
  refuseTurnedSwitches(options);
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
