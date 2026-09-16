/**
 * The per-entry byte budgets, and the log of why each number is what it is.
 *
 * Its own module because the log is the point: every raise carries a date and a
 * reason in the reviewer's words, and a table that long crowds out the checker
 * that reads it (files stay under 600 lines).
 */

import type { BundleBudget } from './bundle-measure';
import { TOOL_ENTRY_BUDGETS } from './entry-budgets-tools';

// Budgets include narrow headroom for patch-level correctness fixes while still
// failing the unminified 1.0.4 artifacts. Public names and source maps are retained.
export const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // 2026-09-12 (Testlauf B, F1): every row that embeds the runtime moves by the
  // measured difference, cushions kept — +287 B raw in an adapter, +400 in core
  // and client, +687/+689 in the barrels. The reason is in bundle-budgets.ts.
  // Adapter rows raised twice on 2026-08-27, measured with ~1 % headroom:
  // +~200 B gzip when the four adapters moved onto the shared preview policy
  // (one decision path per bundle costs more than straight-line code the
  // minifier could fold), then +~1.2 KB gzip for the authorization gate —
  // authorizePreview, strict-mode checks, the defaults profile, the development
  // warnings, and the runtime's source policy embedded in every adapter bundle.
  // The HMAC/session code is not in these bundles; the brand check is imported
  // from the `types` leaf for exactly that reason. 2026-08-27 (1.3.0): the keyed
  // morph (ADR 0008), its diagnostics and the template sanitizer options add
  // ~1.4 KB gzip to the inline runtime and therefore to every adapter bundle. core.* rows: +~200 B gzip for
  // the message bus source policy (eventSourcePolicy), same date. 2026-09-04:
  // +~45 B gzip in every adapter that embeds the runtime, for the reveal ledger
  // fix recorded in bundle-budgets.ts. 2026-09-05: +~70 B gzip in every bundle
  // that embeds the runtime, for the per-instance sanitizer policy (see
  // bundle-budgets.ts); astro +~285 B for `authorizePreview` on the fragment
  // endpoint and `LivePreviewLocals`, the other adapters +~70–120 B for the
  // type-bound locals writes and the shared CSP helper; migrate.js and
  // doctor-cli.js +~170/+~75 B for the `rename-admin-origins-option` codemod;
  // server.* +~50 B for the entry split into a barrel and `preview.ts`;
  // index.js brotli lowered towards its measurement. Brotli is not byte-stable:
  // CI compressed index.js 45 915 and then 45 959 B from byte-identical raw
  // and gzip output, 56–100 B over this host. Every brotli row therefore keeps
  // about 120 B over the local figure, still under the 2 % the improvement
  // hint allows; raw and gzip rows stay tight because they reproduce.
  //
  // 2026-09-06: every row that embeds the inline runtime rises by the ~660 B
  // gzip `onUnboundChange` costs it (see bundle-budgets.ts) — the adapters, the
  // client, core and the root barrel. The Next row additionally carries
  // `livePreviewScriptProps()`, a few dozen bytes. `doctor-cli.js` moves for the
  // runtime source it embeds for its readiness probe, nothing of its own.
  //
  // 2026-09-06 (fragment endpoint for Next.js): the Next row rises ~10 KB raw /
  // ~3.1 KB gzip because that entry now carries the fragment endpoint —
  // authorization, the protocol parser, limits, the registry lookup. It is the
  // same code the Astro entry already carried; a project that never imports
  // `createFragmentEndpoint` does not ship it — the `createLivePreviewMiddleware`
  // fixture in check-tree-shaking.ts measures ~2.4 KB gzip less than this row. The Astro row rises ~200 B raw for the module boundary the
  // move introduces (the endpoint no longer inlines into its one caller).
  //
  // 2026-09-06 (fragment endpoint for SvelteKit and Nuxt, `preview.boundary()`):
  // those two adapter rows rise ~10 KB raw / ~3 KB gzip for the endpoint they
  // now carry, exactly as the Next row did — a project that never imports
  // `createFragmentEndpoint` still ships none of it. `core.*`, `index.*` and
  // `server.*` rise ~650 B raw / ~270 B gzip for `createPreviewBindings().boundary()`:
  // the registry-id and key checks, and the attribute record it builds.
  //
  // 2026-09-06 (Ü9, the lean runtime): `lean.*` are new rows — the second
  // artifact as a value, which is almost entirely the embedded script. It sits
  // behind its own subpath so only a project that imports it carries those
  // bytes; behind a `profile: 'lean'` option instead, the same artifact landed
  // in every adapter entry and measured +24 KB gzip each. Every row that embeds
  // the runtime rises ~90 B raw for the profile's own code: the LP0104 message,
  // the renderers that report it, and the two strategy warnings the lean build
  // keeps as shared functions.
  //
  // 2026-09-06 (Ü11): every row that embeds the runtime carries the LP0503
  // message with it (see bundle-budgets.ts); `fragment.js` moves for the
  // strategy warnings it now shares with the runtime.
  //
  // 2026-09-06 (R5, `delivery: 'asset'`): every adapter entry rises ~500 B gzip.
  // The bootstrap source and the asset descriptor now sit in the shared script
  // path, so all four adapters can serve the runtime as a cached file instead
  // of embedding it — Astro's own loader mode reads the same descriptor rather
  // than a second copy. These are server bundles; the bytes this buys back are
  // the ~38 KB gzip a preview page no longer carries on its second load. The
  // `lean.*` rows rise ~100 B gzip for the artifact's own two digests, without
  // which it could be embedded but never served.
  //
  // 2026-09-06 (R6): the SvelteKit and Nuxt rows rise ~270 B gzip for their own
  // asset routes — the shared response builder was already in the bundle, so
  // this is the route shape each framework wants and nothing more.
  //
  // 2026-09-06 (R8, the build-time annotator): `annotate.js` is a new row and a
  // small one — the plugin is the scanner plus a rewrite, and the scanner is
  // regular expressions. It carries no ts-morph, which is the reason it is an
  // entry of its own rather than part of `./codegen`.
  //
  // 2026-09-06 (LP0409): every row that embeds the runtime rises ~450 B raw /
  // ~130 B gzip for the message the strict sanitizer prints when it removes an
  // attribute the 1.x `'compat'` default kept. Found by upgrading a real 1.8.1
  // consumer: a `data-*` hook driving a CSS selector disappeared on the first
  // write, with nothing said anywhere. The bytes buy the one thing an upgrade
  // could not otherwise discover except by looking.
  //
  // 2026-09-07 (LP-1, the relationship tracker): every row that embeds the
  // runtime rises +431 B raw / ~120 B gzip / ~110 B brotli, and the root barrel
  // +835 B raw because it carries the runtime twice — as code and as the string
  // the generator embeds. The bytes are an identity for Payload's document event
  // and the comparison against the document the message previews. The panel
  // fills `externallyUpdatedRelationship` from `mostRecentUpdate`, which every
  // save of the previewed document raises and nothing clears, so the old
  // `typeof x === 'object'` read a level as an edge and left `skipUnchanged` off
  // for the rest of the session. Replaying the recorded 3.88 session: four
  // `relationshipUpdate` events become none, thirteen post-save writes are
  // skipped that were not. See bundle-budgets.ts for the full reason and for the
  // third of the bytes that is the id comparison.
  //
  // Only two rows exceeded a raw or gzip ceiling and only those two are raised
  // there: `lean.cjs` 81 454 → 81 690 raw / 25 607 → 25 680 gzip (measured
  // 81 561 / 25 631) and `lean.js` 81 443 → 81 680 / 25 602 → 25 670 (measured
  // 81 550 / 25 625). The lean artifact is the smallest thing that carries the
  // whole runtime, so it is where a fixed number of bytes shows first.
  //
  // The brotli rows below are not paid for by new code. They restore the ~120 B
  // cushion this file has documented since 2026-08-27 and which the raise above
  // consumed on every row that embeds the runtime: `adapters/astro/index.js`
  // 38 808 → 38 990, `adapters/astro/middleware-entry.js` 35 247 → 35 380,
  // `adapters/nextjs/index.js` 38 391 → 38 510, `adapters/nuxt/index.js`
  // 38 293 → 38 410, `adapters/sveltekit/index.js` 38 011 → 38 090, `client.cjs`
  // 30 437 → 30 520, `client.js` 30 411 → 30 510, `core.cjs` 32 125 → 32 250,
  // `core.js` 32 102 → 32 200, `index.cjs` 49 801 → 49 910, `index.js`
  // 49 744 → 49 910, `lean.cjs` 22 776 → 22 870, `lean.js` 22 768 → 22 870.
  // Three of those (`astro/index.js`, `core.cjs`, `index.js`) had crossed; the
  // rest were between 6 and 42 B under their ceiling, which is not a budget but
  // a coin flip — brotli does not reproduce on this host: three builds from
  // byte-identical raw and gzip output measured 49 731, 49 758 and 49 785 B for
  // `index.js`. Raw and gzip rows stay tight because they do reproduce.
  //
  // 2026-09-07 (LP-2, keeping a block the registry cannot render): every row
  // that embeds the runtime rises +672 B raw / ~250 B gzip / ~190 B brotli, the
  // `lean.*` rows +643, `core.*` and `client.*` +685 (they carry the source as
  // well), and the root barrel +1 357 because it carries the runtime twice — as
  // code and as the string the generator embeds. `lexical.*` rise +239 raw for
  // LP0410 alone; the write path that keeps the markup is not in that entry.
  // The reason is in bundle-budgets.ts: an empty `<div class="lp-block ...">`
  // was being written over the `<figure><img></figure>` the project's own server
  // had rendered for the block, so a title edit deleted the image from the
  // preview. Only the rows that crossed a ceiling are raised, and only to their
  // measurement plus the cushion this file already documents — raw and gzip
  // tight because they reproduce, brotli ~120 B (~1 % on the two small
  // `lexical.*` rows, where 120 would be 2.4 % of the artifact).
  //
  // Corrected 2026-09-07 (Z19). Two notes above blame brotli for a build that
  // was not reproducible. Brotli is deterministic; the artifact was not.
  // `RUNTIME_BUILD_INFO.generatedAt` held a wall clock, and `index.js` and
  // `index.cjs` are the only two entries that carry it — same raw length, same
  // gzip, six different bytes, which is a substitution only brotli can see. The
  // two CI figures quoted at the top (45 915, then 45 959) are that same effect
  // on that same file, not two answers from one compressor.
  // `npm run build:runtime` now derives SOURCE_DATE_EPOCH from the tested commit,
  // the way `.github/workflows/build.yml` already did, so two builds of one
  // commit are byte-identical on a developer machine as well.
  //
  // Three rows kept cushion that only the noise had justified and go back to
  // their measurement plus the documented ~120 B: `adapters/nextjs/index.js`
  // 38 720 → 38 690 (measured 38 567), `client.cjs` 30 710 → 30 700 (30 572),
  // `index.cjs` 50 220 → 50 160 (50 035). The other rows that raise had lifted —
  // `adapters/nuxt`, `adapters/sveltekit`, `client.js`, `core.js`, `lean.*` —
  // already sit between 100 and 125 B over their measurement: LP-2's real growth
  // spent what LP-1 had banked, and there is nothing left there to take back.
  //
  // The cushion itself stays, for the one difference this host cannot measure:
  // the brotli library in CI's Node. Node 22.22.1 and 24.19.0 compress these
  // artifacts to the same byte here — both ship brotli 1.2.0 — so it may be
  // worth nothing, but that is a measurement for a machine that can see both
  // sides, not a reason to shave every row now.
  //
  // 2026-09-07 (Z3, escalate instead of degrade): every row that embeds the
  // runtime rises +1 303 B raw / ~440 B gzip / ~390 B brotli, the `lean.*` rows
  // +907 (no strategy runner, so no escalation to carry), and the root barrel
  // +2 720 raw because it carries the runtime twice — as code and as the string
  // the generator embeds. `doctor.js`, `fragment.cjs` and `plugins.*` move by
  // +25 raw / ~14 gzip and nothing else: that is the one new entry in the frozen
  // diagnostic table, LP0411, which those entries import whole.
  //
  // The reason is in bundle-budgets.ts. Three facts the runtime already had and
  // discarded — a renderer that refused its value, a Lexical block whose server
  // markup the write had to drop, a changed field with no anchor — now decide
  // whether a strategy should draw the region instead of leaving a patch the
  // server would not have produced. Only the rows that crossed a ceiling are
  // raised, and only to their measurement plus the cushion this file documents:
  // raw and gzip tight because they reproduce (Z19), brotli ~120 B.
  //
  // `doctor.js` keeps its brotli row: 4 762 measured against 4 803, it did not
  // cross. `fragment.js` and `plugins.*` did not cross at all.
  //
  // 2026-09-07 (Z4, merge only when it adds something): every row that embeds
  // the runtime rises +2 712 B raw / ~830 B gzip / ~700 B brotli, the root
  // barrel +5 418 raw because it carries the runtime twice. Thirteen rows
  // crossed; every other row is untouched, because nothing outside the runtime
  // moved.
  //
  // This is the largest single raise in this file, and it is the only one so far
  // that buys a request back rather than a behaviour. Until now every accepted
  // message cost one authenticated POST to Payload's REST API — 18 messages, 18
  // requests, in all five scenarios the interaction budget measures, and 19 of
  // them on a page that had not a single binding to render the answer into. A
  // plain text field now costs none of them, a page nobody binds costs none, and
  // a burst on a relationship or a rich-text field costs two: one that opens it
  // and one that closes it. The bytes are the decision that tells those apart
  // (`src/core/merge-need.ts`) and the window a burst shares; the reasoning is in
  // bundle-budgets.ts.
  //
  // 2026-09-07 (Z5, the write that opens a quiet phase): every row that embeds
  // the runtime rises +172 B raw / ~50 B gzip / ~50 B brotli, `core.*` and
  // `client.*` +167, and the root barrel +339 raw because it carries the runtime
  // twice. Thirteen rows crossed a raw ceiling; three of them also crossed one
  // other metric (`adapters/sveltekit/index.js` brotli, `index.cjs` brotli,
  // `lean.cjs` gzip) and nothing else moved. Only the metrics that crossed are
  // raised, each to its measurement plus the cushion this file documents.
  //
  // The bytes are one timestamp, one comparison and one branch in the scheduler.
  // They buy 50 ms: a keystroke that used to wait out the whole debounce before
  // anything reached the DOM — 66.6 ms p95 in the jsdom interaction gate — now
  // lands on the next frame at 16.6 ms, and the window it opens still coalesces
  // the burst behind it. See bundle-budgets.ts for why it is in the runtime.
  //
  // 2026-09-07 (Z6, the route brake stops swallowing the change): every row that
  // embeds the runtime rises +331 B raw / ~120 B gzip / ~80 B brotli, the root
  // barrel +1 381 raw because it carries the runtime twice, `fragment.*` +167
  // raw for the route strategy's own half, and `adapters/react/index.js` +375
  // raw for `<LivePreviewRouteRefresh />` and the slot it writes. Sixteen rows
  // crossed; nothing else moved.
  //
  // The runtime's share is two things. A refresh the strategy refuses because it
  // is inside its own minimum interval is now handed back and run once when the
  // interval closes, instead of being dropped — the audit measured two unbound
  // changes 286 ms apart and the second one never reached the preview at all.
  // And the refusal is counted apart from a failure, because a single number for
  // "paused on purpose" and "broken" is a number nobody can read.
  //
  // The react row's share buys the risk back: the route strategy morphs fetched
  // HTML into the living page, which on a Next page is DOM React's reconciler
  // owns, and a component that lends the runtime `router.refresh` replaces both
  // the morph and the HTML request with a re-render the framework performs
  // itself. See bundle-budgets.ts for the runtime half.
  //
  // The three small rows (`fragment.*`, `adapters/react/index.js`) take ~60 B of
  // brotli cushion rather than the ~120 the large ones do: 120 is 2.5 % of a
  // 4.8 KB file, which the improvement notice rightly calls slack.
  //
  // 2026-09-07 (Z7, LP0201 one level down): every row that embeds the runtime
  // rises +244 B raw / ~80 B gzip / ~55 B brotli, `core.*` and `client.*` +251,
  // and the root barrel +495 because it carries the runtime twice. Thirteen
  // rows crossed a raw and a gzip ceiling; four of them also crossed brotli.
  // Nothing outside the runtime moved.
  //
  // The bytes are the descent: a group nothing on the page addresses is opened
  // once and its scalars are reported under the path a binding would carry, so
  // an edit to `admission.priceFrom` is named instead of silently doing nothing.
  // The reasoning and the limits (one level, no arrays) are in bundle-budgets.ts.
  //
  // Two brotli rows that did not cross are raised with them:
  // `adapters/nextjs/index.js` 40_040 → 40_140 and `lean.cjs` 24_130 → 24_240.
  // The growth left them 21 and 14 B under their ceiling, and a row that close
  // is not a budget — it is the coin flip this file already refused once, for
  // the one difference this host cannot measure (the brotli library in CI's
  // Node). Every other brotli row still sits 60 B or more under.
  //
  // 2026-09-07 (Z22, an item rebuilt from a template keeps what the template
  // cannot carry): every row that embeds the runtime rises +448 B raw / ~430 B
  // gzip / ~200 B brotli, `core.*` and `client.*` +430, the root barrel +876
  // because it carries the runtime twice, and `structural.*` +523 — that entry
  // is the applier itself, so the change is a larger share of it. Eleven rows
  // crossed all three metrics and `structural.*` two; `lean.*` hold on every
  // one, because the lean artifact carries neither array renderer and pays only
  // the 25 B of shared attribute rule.
  //
  // The bytes buy the class of defect the runtime cannot see: a write that
  // succeeds and still differs from the server's markup. An item rebuilt from
  // `data-payload-array-template` carried what the author wrote and nothing the
  // framework's compiler had put around it — Astro's `data-astro-cid-…`, Vue's
  // `data-v-…`, Svelte's class — so the patched list lost its scoped styling
  // while every check passed. See bundle-budgets.ts; the acceptance is the
  // fidelity oracle green with that exception deleted.
  //
  // 2026-09-10 (Z20, LP0412): +851 B raw in every row that embeds the runtime,
  // +1 729 in `index.*` because that barrel carries it twice, +820 in `lean.*`
  // and +30 in the rows that carry only the diagnostic-code table
  // (`doctor.js`, `fragment.*`, `plugins.cjs`). `core.cjs` brotli and every
  // `structural.*`, `lexical.*`, `server.*` and `plugins.js` row still hold and
  // are left where they were — only what actually broke is raised. The
  // reasoning for the bytes is in bundle-budgets.ts; the short version is that
  // the runtime now says out loud, once per binding, that it wrote a different
  // reading of a date or a number than the template did.
  //
  // `core.cjs` brotli is the exception to "only what broke": it measured 33 932
  // against a ceiling of 33 935 and held, then 33 997 from byte-identical raw
  // and gzip output on the next build. Brotli is not byte-stable here — the
  // note above says so for the same reason — so it goes to 34 120, the usual
  // ~120 B over the measurement, rather than back onto a three-byte margin.
  //
  // 2026-09-10 (Z9, auto-binding): every row that embeds the runtime rises
  // +3 913 B raw / ~1 360 B gzip / ~1 170 B brotli, `index.*` about twice that
  // because the barrel carries the runtime as code and as the string the
  // generator embeds, `lean.*` +~450 raw / ~200 gzip for the option slot, the
  // marker the cache reads, the two inspection fields and the LP0104 line —
  // the search itself is not in the lean artifact — and `plugins.*` +~550 raw
  // / ~150 gzip for the overlay's second heading. Measured against the same
  // build without the change; the reason for the bytes, and the way to get
  // them back, is in bundle-budgets.ts. Every crossed row goes to its
  // measurement plus the usual cushion (raw ~110, gzip ~50, brotli ~130); a
  // metric that still held is left where it was.
  //
  // 2026-09-10 (Z25, the diagnostic table leaves the runtime): every row that
  // embeds the runtime falls −1 287 B raw / ~−520 B gzip / ~−370–450 B brotli,
  // `index.*` −1 302 because the barrel carries the runtime as the string the
  // generator embeds as well. The bytes were the frozen `DIAGNOSTIC_CODES`
  // record, pulled into the inline runtime since Z6 by one property read in
  // the strategy runner (see bundle-budgets.ts). Seven rows go down to their
  // new measurement plus the cushion this file documents: the four adapters,
  // the Astro middleware entry and the two root barrels. `client.*` and
  // `core.*` export the table themselves and moved by 11–15 B raw, `lean.*`
  // never carried it, `doctor-cli.js` embeds an artifact that did not change;
  // all of those stay where they were.
  //
  // 2026-09-10 (Z26, a route refresh keeps the guesses): every row that embeds
  // the runtime rises +910 B raw / ~+300 B gzip / ~+230 B brotli, `client.*`
  // and `core.*` +1 000, `index.*` +1 910 because the barrel carries the
  // runtime twice, `lean.*` +115 for the state slot and the folded method —
  // the search stays out of that artifact. Fifteen rows crossed; the two
  // `lean.*` brotli rows held and stay. What the bytes buy is in
  // bundle-budgets.ts: a guess that used to be gone after the first route
  // refresh, and a refresh per keystroke after that, is looked for again on
  // the fresh markup instead. Each crossed metric goes to its measurement plus
  // the cushion this file documents.
  //
  // 2026-09-11 (Z28, the trusted core's mutation run): every row that embeds
  // the runtime falls −819 B raw / ~−140 B gzip / ~−40–180 B brotli, `index.*`
  // −1 639 because the barrel carries the runtime twice, the React and Vue
  // rows −648 raw / ~−90 gzip for the bus and the merger they carry,
  // `lexical.*` −144 and `structural.*` −154 for the escape and URL helpers.
  // The bytes were lines no test could reach — guards a later check repeated,
  // a fallback nothing could hit, probes a call makes itself; the list is in
  // bundle-budgets.ts. All 19 rows that moved go down to their measurement
  // plus the cushion each carried; the brotli rows that embed the runtime keep
  // at least the ~130 B the epoch swing above asks for.
  //
  // 2026-09-11 (Z30, the block verdict spoken by the write): every row that
  // embeds the runtime rises +764 B raw / ~+183 B gzip / ~+100–250 B brotli
  // (`client.*` and `core.*` +836, which carry the source as well; `index.*`
  // +1 600, the runtime twice), `lexical.*` falls −124 raw / ~−43 gzip — the
  // warn-once left the node renderer for the write — and `doctor.js`,
  // `fragment.*` and `plugins.*` move +29 raw for the frozen table's new row
  // (LP0413). The bytes are the two texts and the verdict behind them, the
  // listener the render context carries to the block renderer, and the three
  // counters `inspect().fidelity` reads; see bundle-budgets.ts. Every row goes
  // to its measurement plus the cushion it carried; the brotli rows that embed
  // the runtime keep at least the ~130 B the epoch swing above asks for.
  //
  // 2026-09-11 (Z29, the pairing descends into the template's wrapper): every
  // row that embeds the runtime rises +293 B raw / ~+93 B gzip / ~+30–110 B
  // brotli (`client.*` and `core.*` +326 with the source, `index.*` +619 for
  // the runtime twice); nothing else moves. The bytes are the one function
  // that recognises a `<div class="prose">` around a rich-text field and its
  // two guards — the tag list, and the comparison against the rendered
  // document's own top-level elements — so the block-keeping write pairs
  // where the blocks are and the wrapper stays; see bundle-budgets.ts. Every
  // row to its measurement plus the cushion it carried, brotli at least ~130.
  //
  // 2026-09-11 (Z29, measured after the commit): seven brotli rows go to the
  // measurement the committed tree gives plus the ~130 B this file promises —
  // `index.cjs` 54_965 → 55_069 (54_939), `client.js` 33_935 → 33_982 (33_852),
  // `core.js` 35_654 → 35_697 (35_567), `core.cjs` 35_700 → 35_741 (35_611),
  // `adapters/nuxt/index.js` 41_465 → 41_489 (41_359), `lean.js` 24_789 →
  // 24_799 (24_669), `lean.cjs` 24_798 → 24_801 (24_671). The Z29 rows above
  // were set from a build before the commit, and the commit moved the epoch
  // that `generatedAt` is pinned to (Z19): same length, different bytes, and
  // brotli alone sees it — `index.cjs` came out 104 B higher and sat 26 B
  // under its ceiling, which the Z20 paragraph below calls a coin flip. raw
  // and gzip did not move and keep their rows.
  //
  // 2026-09-11 (Z27, the first write waits for React): every row that embeds
  // the runtime rises +1 925 B raw / ~+710 B gzip / ~+660 B brotli (`client.*`
  // and `core.*` ~+1 800 raw with the source, `index.*` ~+3 700 for the runtime
  // twice, `lean.*` ~+1 800); the four adapter rows rise ~+3 000 raw / ~+1 000
  // gzip, because they also carry the bootstrap built armed for React (1 036 B
  // beside the plain 431) that the generator emits for a Next asset page, and
  // the page-facts parameter the policy threads through; `doctor.js` and
  // `fragment.*` move +8…16 raw for the frozen table's new row (LP0607). The
  // bytes are the wait: the hook React injects into and the recorder the
  // bootstrap shares with it, the commit judgement, the cap, the two-stage
  // start the lifecycle handed to `startup.ts`, and `inspect().hydration`;
  // see bundle-budgets.ts and ADR 0015. Every row to its measurement plus the
  // cushion this file documents (raw ×1.001, gzip ×1.0014, brotli +130), the
  // three rows that only crossed on raw and gzip keep their brotli ceiling;
  // measured before the commit, so the brotli rows are read again after it.
  //
  // 2026-09-11 (merge of main #64/#65): +305 raw / ~112 gzip per runtime row, raised by the measured difference.
  // 2026-09-11 (Z31, the first write waits for Vue): every row that embeds the
  // runtime rises +1 085 B raw / ~+330 gzip / ~+280 brotli (`index.*` twice, as
  // code and as source); the adapter rows ~+930 raw for the runtime and the page
  // facts the Nuxt adapter threads through — no second bootstrap, Vue's mount is
  // state a late runtime reads (`hydration-vue.ts`, ADR 0015 addendum). Each row to
  // its measurement plus the cushion; reread after the commit, `index.cjs` brotli 56_351 → 56_388 (56_258, the epoch, Z19).
  // 2026-09-11 (Z37, the script names its defaults): the five adapter rows cross
  // gzip by 3–21 B, ~+50 B raw — the generator resolves `defaults` and writes it
  // into the last slot of every script. gzip to the measurement ×1.0014, and nuxt brotli, 26 B under, back to the ~130 B cushion.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 2 950 → 3 426 (+476 B, measured 2 924 → 3 400); gzip 1 544 → 1 733 (+189 B, measured 1 529 → 1 718); brotli 1 380 → 1 566 (measured 1 538; under the 2 % notice).
  'annotate.js': { raw: 3_426, gzip: 1_733, brotli: 1_566 },
  // 2026-09-12 (C2, LP0801 reaches the log): +30 B raw wherever the runtime sits — this row and INLINE_BUDGET raw go to the measurement, `core.js` brotli to measurement plus the documented cushion.
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): gzip 50 878 → 50 888, the fix's
  // +10 B (measured 50 870 → 50 880); cushion kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 50 888 → 50 901 (+13 B, measured 50 880 → 50 893); brotli 43 515 → 43 631 (measured 43 511, 4 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 161 256 → 161 305 (+49 B, measured 161 217 → 161 266); gzip 50 901 → 50 911 (+10 B, measured 50 893 → 50 903).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 50 911 → 50 918 (+7 B, measured 50 903 → 50 910).
  'adapters/astro/index.js': { raw: 161_305, gzip: 50_918, brotli: 43_631 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): brotli 39 900 → 40 030 (measured 39 910, -10 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 147 776 → 147 825 (+49 B, measured 147 742 → 147 791); gzip 46 671 → 46 681 (+10 B, measured 46 665 → 46 675).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 46 681 → 46 688 (+7 B, measured 46 675 → 46 682).
  'adapters/astro/middleware-entry.js': { raw: 147_825, gzip: 46_688, brotli: 40_030 },
  //
  // 2026-09-07 (Z8, an async server component for Next): one row moves, and only
  // this one. `adapters/nextjs/index.js` rises +177 B raw / +43 B gzip for
  // `<LivePreviewScript />` — the policy call, the decision branch and the
  // element it builds. Nothing else in the package sees it: `react` is reached
  // through a lazy dynamic import, so no entry gains a static dependency, and
  // `check-tree-shaking.ts` still measures 43 990 gzip for a project that
  // imports only `createLivePreviewMiddleware`. The brotli row rises with them
  // even though it did not cross: it sat 21 B under its ceiling after Z19
  // trimmed it, and this file has already said once that 21 B is a coin flip
  // rather than a budget on the one measurement CI's Node can disagree about.
  // Back to the documented ~120 B.
  //
  // The bytes buy the only delivery in this package that can decline to render.
  // A root layout renders for every visitor and the two synchronous helpers
  // cannot wait for a verdict, so LP-8 measured 195 342 of 254 707 bytes of
  // runtime on a request with no cookie; an async component awaits
  // `authorizePreview` and renders nothing for it.
  //
  // 2026-09-14 (2.0.0): the release version is four characters shorter than
  // `2.0.0-rc.1`, and this adapter carries it once. Measured on this host from
  // the same source, only the version line differing: raw 159 588 → 159 583
  // (-5), gzip 50 297 → 50 293 (-4), brotli 43 074 → 43 199 (**+125**). A
  // shorter input compressing worse is the substitution effect this file
  // already records two notes above; it is why every brotli row keeps a
  // cushion. Here the shift is 5 B larger than that cushion, so the row goes to
  // the 2.0.0 measurement plus the documented ~120 B. raw and gzip keep their
  // numbers: both fell and both stay inside their ceilings.
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 159 664 → 159 713 (+49 B, measured 159 663 → 159 712).
  // 2026-09-16 (2.0.1 Version PR): gzip 50 454 → 50 467. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 50 455 against a cushion of -1 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 159 713 → 159 731 (+18 B, measured 159 712 → 159 730); gzip 50 467 → 50 473 (+6 B, measured 50 454 → 50 460).
  'adapters/nextjs/index.js': { raw: 159_731, gzip: 50_473, brotli: 43_319 },
  //
  // 2026-09-06 (`./react`, `./vue`): two new rows, measured at 14 045 / 13 814
  // raw and 4 637 / 4 621 gzip. Both entries carry the message bus, the origin
  // detector and the merger — the document half of the runtime — and nothing
  // that touches an element, which is why each is a third of an adapter row.
  // They share every module but their reactivity, hence the near-identical
  // figures.
  'adapters/react/index.js': { raw: 13_992, gzip: 4_759, brotli: 4_354 },
  'adapters/vue/index.js': { raw: 13_352, gzip: 4_600, brotli: 4_148 },
  //
  // 2026-09-06 (R4, zero-config setup): one new row. `adapters/nuxt/module.js`
  // is the build-time Nuxt module — a few hundred bytes, because all it does is
  // write a plugin into `.nuxt/` and register its path; the runtime it pulls in
  // is the existing `./nuxt` entry, which the generated plugin imports. The Next
  // row rises ~700 B gzip for `withLivePreview()`: the header rules and the
  // frame-ancestors builder it shares with the middleware.
  'adapters/nuxt/module.js': { raw: 660, gzip: 426, brotli: 349 },
  // 2026-09-12 (C1): sveltekit brotli 42 479 → 42 620, the only metric the drawer-edit fix crossed (measured 42 500 + the ~120 B cushion).
  // 2026-09-14 (2.0.1): brotli 42 955 → 43 092. Its cushion was 4 B (measured 42 951), which
  // brotli's run-to-run swing crosses with no code change; the fix's build measured 42 972 and
  // the row now carries the ~120 B the other brotli rows keep.
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 158 976 → 159 025 (+49 B, measured 158 943 → 158 992).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 50 291 → 50 296 (+5 B, measured 50 279 → 50 284).
  'adapters/nuxt/index.js': { raw: 159_025, gzip: 50_296, brotli: 43_092 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): brotli 42 740 → 42 835 (measured 42 715, 25 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 157 966 → 158 015 (+49 B, measured 157 932 → 157 981).
  'adapters/sveltekit/index.js': { raw: 158_015, gzip: 49_998, brotli: 42_835 },
  // The build tools (codegen, doctor, codemods) are logged in `entry-budgets-tools.ts`, split off at 500 lines (Z37).
  ...TOOL_ENTRY_BUDGETS,
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): raw +44 B each, the fix's own bytes; cushions kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 134 511 → 134 545 (+34 B, measured 134 484 → 134 518); brotli 36 884 → 37 002 (measured 36 882, 2 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 134 545 → 134 594 (+49 B, measured 134 518 → 134 567); gzip 42 707 → 42 723 (+16 B, measured 42 705 → 42 721).
  // 2026-09-16 (2.0.1 Version PR): gzip 42 723 → 42 733. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 42 721 against a cushion of 2 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 134 594 → 134 725 (+131 B, measured 134 567 → 134 698); gzip 42 733 → 42 777 (+44 B, measured 42 721 → 42 765).
  'core.cjs': { raw: 134_725, gzip: 42_777, brotli: 37_002 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 133 971 → 134 005 (+34 B, measured 133 945 → 133 979).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 134 005 → 134 054 (+49 B, measured 133 979 → 134 028); gzip 42 628 → 42 646 (+18 B, measured 42 628 → 42 646); brotli 36 811 → 36 934 (measured 36 814, -3 B left; ~120 B as the other brotli rows).
  // 2026-09-16 (2.0.1 Version PR): gzip 42 646 → 42 658. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 42 646 against a cushion of 0 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 134 054 → 134 185 (+131 B, measured 134 028 → 134 159); gzip 42 658 → 42 702 (+44 B, measured 42 646 → 42 690).
  'core.js': { raw: 134_185, gzip: 42_702, brotli: 36_934 },
  //
  // 2026-09-10 (Z20 acceptance): the `index.cjs` brotli ceiling is restored to
  // the ~120 B cushion the other rows carry. It had been trimmed to ~90 B by a
  // measurement taken *before* the commit — and the epoch that pins the build
  // (Z19) is the commit's own timestamp, so committing moved `generatedAt`,
  // same length, different bytes: 52 647 brotli at the previous commit's epoch,
  // 52 761 at this one's, from an unchanged tree. Two builds of one commit are
  // identical; a build before the commit and one after are not. A brotli
  // cushion below that swing is a coin flip at every commit boundary, which is
  // why the cushion is what it is. raw and gzip do not move with the epoch.
  // 2026-09-10 (Z25): both barrels −1 302 raw (see above); the brotli rows go
  // to their measurement before the commit plus the ~130 B the paragraph above
  // asks for, `index.js` from a 32 B margin that had been a coin flip since Z9.
  // 2026-09-14: `index.js` brotli crossed on main at 56 804 against a 56 798
  // ceiling — six bytes, from a tree whose raw output is byte-identical. Five
  // consecutive CI runs measured 56 759 / 56 779 / 56 780 / 56 782 / 56 804 with
  // raw fixed at 282 014 and gzip moving by one byte: a 45 B brotli swing under
  // a ceiling sitting 16-39 B above it. That is the coin flip the paragraph
  // above describes, and Z25's ~130 B cushion had been trimmed back to 19 B
  // against this host. Both rows go to the highest observed CI figure plus that
  // cushion. `index.cjs` is raised with it although it has not crossed: it is
  // the same barrel built twice, 56 837 here against a 56 952 ceiling, so ~90 B
  // once CI's 20-25 B are added — the same coin, not yet fallen. raw and gzip
  // keep their numbers; raw reproduces exactly and gzip to a byte.
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): raw +88 B each, twice the 44 B the
  // other rows grew; cushions kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 282 737 → 282 801 (+64 B, measured 282 715 → 282 779); gzip 88 571 → 88 594 (+23 B, measured 88 561 → 88 584).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 282 801 → 282 899 (+98 B, measured 282 779 → 282 877); gzip 88 594 → 88 624 (+30 B, measured 88 583 → 88 613).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 282 899 → 283 048 (+149 B, measured 282 877 → 283 026); gzip 88 624 → 88 668 (+44 B, measured 88 613 → 88 657).
  'index.cjs': { raw: 283_048, gzip: 88_668, brotli: 57_090 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 282 113 → 282 177 (+64 B, measured 282 092 → 282 156); gzip 88 558 → 88 583 (+25 B, measured 88 555 → 88 580).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 282 177 → 282 275 (+98 B, measured 282 156 → 282 254); gzip 88 583 → 88 610 (+27 B, measured 88 580 → 88 607).
  // 2026-09-16 (2.0.1 Version PR): gzip 88 610 → 88 619. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 88 607 against a cushion of 3 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 282 275 → 282 428 (+153 B, measured 282 254 → 282 407); gzip 88 619 → 88 664 (+45 B, measured 88 607 → 88 652).
  'index.js': { raw: 282_428, gzip: 88_664, brotli: 56_934 },
  // The two smallest entries are budgeted to 5 bytes rather than 50: at ~1 KB a
  // 50-byte step is 5 % of the artifact, which stops being a budget.
  'payload.cjs': { raw: 1_090, gzip: 575, brotli: 515 },
  'payload.js': { raw: 1_080, gzip: 575, brotli: 515 },
  // Measured 2026-08-27 (12465/4730/4307 and 12292/4670/4212), ~1 % headroom.
  // 2026-09-06 (R8): +~110 B raw for `previewBindingsFromLocals`, the one-line
  // helper the build-time annotator writes a call to.
  'server.cjs': { raw: 12_950, gzip: 4_780, brotli: 4_310 },
  'server.js': { raw: 12_830, gzip: 4_775, brotli: 4_300 },
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): raw +44 B each, the fix's own bytes; cushions kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 128 734 → 128 768 (+34 B, measured 128 713 → 128 747).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 128 768 → 128 817 (+49 B, measured 128 747 → 128 796); gzip 40 643 → 40 656 (+13 B, measured 40 635 → 40 648).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 128 817 → 128 950 (+133 B, measured 128 796 → 128 929); gzip 40 656 → 40 697 (+41 B, measured 40 648 → 40 689).
  'client.cjs': { raw: 128_950, gzip: 40_697, brotli: 35_222 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 128 653 → 128 687 (+34 B, measured 128 632 → 128 666); brotli 35 116 → 35 236 (measured 35 116, 0 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 128 687 → 128 736 (+49 B, measured 128 666 → 128 715); gzip 40 630 → 40 644 (+14 B, measured 40 621 → 40 635).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 128 736 → 128 869 (+133 B, measured 128 715 → 128 848); gzip 40 644 → 40 684 (+40 B, measured 40 635 → 40 675).
  'client.js': { raw: 128_869, gzip: 40_684, brotli: 35_236 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 018 → 7 028 (+10 B, measured 7 010 → 7 020); brotli 6 322 → 6 425 (measured 6 305, 17 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 20 003 → 20 136 (+133 B, measured 19 916 → 20 049); gzip 7 028 → 7 069 (+41 B, measured 7 020 → 7 061).
  'structural.cjs': { raw: 20_136, gzip: 7_069, brotli: 6_425 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 019 → 7 029 (+10 B, measured 7 014 → 7 024); brotli 6 326 → 6 427 (measured 6 307, 19 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 19 958 → 20 091 (+133 B, measured 19 870 → 20 003); gzip 7 029 → 7 068 (+39 B, measured 7 024 → 7 063).
  'structural.js': { raw: 20_091, gzip: 7_068, brotli: 6_427 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 768 → 91 802 (+34 B, measured 91 749 → 91 783).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 802 → 91 851 (+49 B, measured 91 783 → 91 832); gzip 29 177 → 29 190 (+13 B, measured 29 171 → 29 184).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 851 → 91 869 (+18 B, measured 91 832 → 91 850); gzip 29 190 → 29 197 (+7 B, measured 29 184 → 29 191).
  'lean.cjs': { raw: 91_869, gzip: 29_197, brotli: 25_916 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 757 → 91 791 (+34 B, measured 91 738 → 91 772).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 791 → 91 840 (+49 B, measured 91 772 → 91 821); gzip 29 171 → 29 183 (+12 B, measured 29 167 → 29 179).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 840 → 91 858 (+18 B, measured 91 821 → 91 839); gzip 29 183 → 29 190 (+7 B, measured 29 179 → 29 186).
  'lean.js': { raw: 91_858, gzip: 29_190, brotli: 25_929 },
  // 2026-09-16 (2.0.1 Version PR): gzip 5 602 → 5 612. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 5 600 against a cushion of 2 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 307 → 16 527 (+220 B, measured 16 305 → 16 525); gzip 5 612 → 5 665 (+53 B, measured 5 600 → 5 653); brotli 5 072 → 5 162 (measured 5 072; under the 2 % notice).
  'lexical.cjs': { raw: 16_527, gzip: 5_665, brotli: 5_162 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 278 → 16 490 (+212 B, measured 16 276 → 16 488); gzip 5 606 → 5 658 (+52 B, measured 5 602 → 5 654); brotli 5 079 → 5 165 (measured 5 075; under the 2 % notice).
  'lexical.js': { raw: 16_490, gzip: 5_658, brotli: 5_165 },
  //
  // 2026-09-06 (Ü10): `plugins.*` rise ~2 900 raw / ~1 150 gzip for the
  // unbound-fields overlay — the development panel that lists the fields an
  // update carried and the page cannot show. It is a plugin precisely so this
  // row moves and `INLINE_BUDGET` does not: no page carries it unless its own
  // code asks for it.
  // The `plugins.*` brotli rows carry ~100 B over their measurement rather than
  // the ~130 the runtime-carrying rows keep: this entry embeds no runtime, so
  // the epoch that moves `generatedAt` cannot move it, and at 6 KB the wider
  // cushion is over the 2 % the improvement hint allows (measured after the
  // Z9 commit: 6 179 / 6 163).
  'plugins.cjs': { raw: 19_293, gzip: 7_106, brotli: 6_283 },
  'plugins.js': { raw: 19_269, gzip: 7_092, brotli: 6_282 },
  'fragment.cjs': { raw: 14_238, gzip: 5_532, brotli: 4_873 },
  'fragment.js': { raw: 14_172, gzip: 5_489, brotli: 4_847 },
};
