/**
 * Build-time flags esbuild replaces with a literal (`define`). They are read
 * through `typeof`, so an entry built without them — the programmatic client,
 * every test — sees `undefined` and keeps every feature.
 *
 * Two rules, both measured rather than assumed (Ü9 in the private roadmap):
 *
 * 1. The flag must be read **directly** at the site. esbuild substitutes the
 *    identifier but does not propagate a `const` derived from it — not even
 *    within one module — so `const LEAN = __LEAN_BUILD__` keeps both branches
 *    and every module behind them.
 * 2. The guard must be an **expression**, not a statement. `if (flag) return x;`
 *    folds the condition and leaves the code after it referenced; a ternary or
 *    `&&` drops the branch, and with it the modules only that branch reached.
 *
 * Hence the idiom, repeated at each site rather than shared:
 *
 * ```ts
 * return typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__ ? lean() : full();
 * ```
 */

/** `true` in the inline artifact; the client entry calls the bootstrap itself. */
declare const __INLINE_BUILD__: boolean | undefined;

/** `true` in the lean artifact (`profile: 'lean'`); see `src/core/profile.ts`. */
declare const __LEAN_BUILD__: boolean | undefined;
