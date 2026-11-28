/**
 * Build-time flags esbuild replaces with a literal (`define`). They are read
 * through `typeof`, so an entry built without them — the programmatic client,
 * every test — sees `undefined` and keeps every feature.
 *
 * Two rules, both measured rather than assumed:
 *
 * 1. The flag must be read **directly** at the site. esbuild substitutes the
 *    identifier but does not propagate a `const` derived from it — not even
 *    within one module — so a constant read from a flag keeps both branches
 *    and every module behind them.
 * 2. The guard must be an **expression**, not a statement. `if (flag) return x;`
 *    folds the condition and leaves the code after it referenced; a ternary or
 *    `&&` drops the branch, and with it the modules only that branch reached.
 */

/** `true` in the inline artifact; the client entry calls the bootstrap itself. */
declare const __INLINE_BUILD__: boolean | undefined;

/**
 * `true` in the bootstrap built for a page that declares React hydration
 * (ADR 0015): it arms the commit signal before it fetches the runtime, which
 * may otherwise arrive after `react-dom` has evaluated. See `src/runtime/core/session/loader.ts`.
 */
declare const __REACT_BOOTSTRAP__: boolean | undefined;
