/**
 * The 1.x names that 2.0 renamed, kept so a 1.x project compiles unchanged.
 *
 * A file of its own, and a small one: everything deprecated for 3.0 that the
 * rename ledger produced lives here, so removing it is one deletion rather than
 * a search. It also keeps the alias out of the module that defines the real
 * function, where two exports of one value read as an accident.
 *
 * Measured against the published 1.8.1 declarations, entry by entry, not
 * guessed: `isPreviewRequest` was exported from the root **and** from
 * `./astro`, so it is re-exported from both. The other seven names 2.0 dropped
 * moved behind `definePreview()` or changed shape, where an alias would restore
 * the very defaults the move removed (ADR 0007, ledger rows 1 and 9).
 */

import { hasPreviewIntent } from './preview-request';

/**
 * @deprecated Use `hasPreviewIntent`; removed in 3.0. `pll migrate` rewrites it.
 */
export const isPreviewRequest = hasPreviewIntent;
