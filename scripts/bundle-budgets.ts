/**
 * The inline-profile byte budgets, and the log of why each number is what it
 * is. The measurement itself is in `bundle-measure.ts`, moved out when this
 * log reached the 500-line limit the way `entry-budgets.ts` did before it —
 * every reason recorded here stays where the notes that cite it point.
 */

/** Exact inline transfer-size ceilings used by the release gate. */
// Set 2026-08-28 after the 2.0 correctness pass: 26 910 → 28 736 gzip. The
// +1 745 is new behaviour, not slack — Payload 3.x link/table/inline-block
// rendering, class-based Lexical output, `mailto:` and responsive-image
// writes, local-time date inputs, one value contract across the renderers,
// the morph's focus and selection restore, and the scheduler's flush deadline.
// A page without `fragments` still carries no fragment client at all; that
// client is the difference to INLINE_FRAGMENT_BUDGET.
//
// Raised again the same day: 28 736 → 28 923 gzip. The +187 buys the reveal's
// identity ledger, which lets a field the server re-renders be recognised as
// the edited one, the binding-level reveal that picks the edited document's
// element when a page previews several, and a rejection boundary around the
// update pipeline so an unexpected throw is logged instead of escaping.
//
// Raised 2026-09-04: 28 923 → 28 966 gzip. The +43 makes the reveal ledger
// record what a revision revealed rather than what it saw, so a message that
// supersedes one before its reveal point still owes — and pays — the reveal.
// A slow first reveal caused the admin to re-send, and the re-send cancelled
// the only reveal there was; Firefox in CI reproduced it one run in seven.
//
// Raised 2026-09-05: 28 966 → 29 035 gzip. The +69 is net. The sanitizer
// policy became instance state (ADR 0002) — it travels through the runtime
// options into every render context, so two clients on one page no longer
// share whichever policy was set last — and that costs about a hundred bytes;
// the LRU helpers behind both caches and the fragment client's shared abort
// scaffolding give a third of it back. The reveal ledger as its own module and
// the `revision` and `hidesWhenEmpty` names are free.
//
// Raised 2026-09-06: 29 035 → 29 071 gzip. The +36 is what every page pays so
// that any page can refresh its route. The route strategy used to arrive only
// inside the fragment prelude, which the generator emitted only for a page that
// configured a fragment endpoint — so `data-payload-strategy="route"` and a
// binding in `<head>` did nothing outside Astro, the one framework with an
// endpoint helper. The runtime now looks for a second prelude
// (`__LIVE_PREVIEW_ROUTE__`) as well, and those two `typeof` checks and the
// branch between them are the bytes. A page that carries neither prelude still
// carries no strategy code at all.
//
// Raised 2026-09-06: 29 071 → 29 729 gzip. The +658 buys `onUnboundChange`: the
// runtime now knows whether a changed field has anywhere on the page to land,
// and can refresh the route instead of dropping the edit. Most of it is the
// addressability rules that the LP0201 diagnostic and the strategy decision now
// share (`src/core/unbound-fields.ts`) — the locale suffix, the owner scope, and
// the fact that a binding on `hero.eyebrow` covers the top-level field `hero`
// the diff reports. The rest is the baseline flag on the diff and the LP0807
// message.
//
// This is the largest single raise so far, and a page that leaves the option at
// `'ignore'` pays it too. It is in the runtime rather than in the route prelude
// because the decision needs the binding cache, the message locale and the owner
// scope, none of which cross the strategy seam — moving it would mean a second,
// weaker copy of the same rules. Making the seam carry them is the way to get
// these bytes back; see the Ü9 note in the private roadmap.
//
// Raised 2026-09-06: 29 729 → 30 221 gzip. The +492 is `data-payload-format`:
// the closed vocabulary that decides how a date or a number is written, and the
// LP0408 message that names the whole vocabulary when a page asks for something
// outside it. It buys the fields a template formats server-side — a price, a
// long date — the ability to be bound at all; until now they had to be left out,
// and a field nobody binds is one an editor changes without seeing anything.
//
// Raised 2026-09-06: 30 221 → 30 290 gzip. The +32 measured is the two strategy
// warnings (LP0407, LP0806) becoming shared functions rather than methods, so
// the lean profile below can keep answering a page that asks for a strategy it
// does not carry. The rest is headroom.
//
// Raised 2026-09-06 (Ü11): +165 gzip for LP0503 — the line a page prints when an
// admin it trusts sends a message this runtime does not recognise. The wire
// format is mirrored by hand here, so drift was silent until now: the message
// was dropped and the preview simply stopped updating. One sentence in the
// console is what turns that into a report.
// 2026-09-06 (LP0409): +~450 B raw / ~130 B gzip in every inline profile for
// the message the strict sanitizer prints when it drops an attribute the 1.x
// `'compat'` default kept. The lean profile carries it too: the sanitizer is
// not one of the features that profile leaves out, so the report belongs there
// as much as anywhere.
// 2026-09-07 (LP-1, the relationship tracker): every artifact that embeds the
// runtime rises +431 B raw / ~120 B gzip / ~110 B brotli, measured against the
// same build without the change. The bytes are an identity for Payload's
// document event and a comparison against the document the message previews.
// `externallyUpdatedRelationship` is not a flag: the panel fills it from
// `useDocumentEvents().mostRecentUpdate`, which every save of the previewed
// document raises and which nothing ever clears, so from the first save on it
// was set in every message. What stood here before was `typeof x === 'object'`,
// and the distance between "the field is present" and "the field means
// something that has not happened yet" is exactly this code — an identity kept
// between messages (`entitySlug`, id, `updatedAt`; never id alone, a global's
// save carries none) plus the slug-and-id comparison. Replaying the recorded
// 3.88 admin session that crosses a save: four `relationshipUpdate` events
// become none, and thirteen writes after the save are skipped that were not.
// About a third of it is the id comparison, and that third is what keeps a page
// previewing a collection from missing a sibling document's save; dropping it
// would fit under the old numbers and hand back half the finding.
//
// Raised 2026-09-07: raw 98 739 → 98 930 (measured 98 777). The gzip and the
// fragment-profile raw rows below still hold and stay where they are.
//
// Raised 2026-09-07 (brotli): 27 395 → 27 500 (measured 27 371). Not paid for by
// new code — it restores the ~120 B cushion this file has documented since
// 2026-08-27 and which the raise above ate. Brotli does not reproduce here:
// three builds from byte-identical raw and gzip output measured 49 731, 49 758
// and 49 785 B for `index.js`. A row sitting 24 B under its ceiling is a coin
// flip, not a budget.
//
// Corrected the same day: the observation was right, the explanation was not.
// Brotli is deterministic; the artifact was not. Two builds had the same raw
// length and the same gzip but six different bytes, all of them inside
// `RUNTIME_BUILD_INFO.generatedAt` — a wall clock embedded in the runtime that
// `index.js` and `index.cjs` carry. A substitution of equal length is invisible
// to raw and to gzip and visible to brotli, which is why only brotli looked
// unstable. `npm run build:runtime` now derives SOURCE_DATE_EPOCH from the
// tested commit the way `.github/workflows/build.yml` already did, so two builds
// of one commit are byte-identical on a developer machine as well
// (`tests/integration/reproducible-runtime-build.test.ts`). The cushion stays
// for the one difference this host cannot measure — the brotli library in CI's
// Node — not for a build that moved under its own feet.
//
// 2026-09-07 (LP-2, keeping a block the registry cannot render): every artifact
// that embeds the runtime rises +672 B raw / ~245 B gzip / ~190 B brotli — the
// lean profile +643, which is the same code minus what it shares with the morph
// it does not carry. Measured against the same build without the change.
//
// What the bytes buy is an image that stops disappearing. A `block` node whose
// slug has no registered renderer rendered as an empty `<div class="lp-block
// lp-block--mediablock">`, and that empty div was written over the `<figure>`
// with the `<img>` the project's own server had already rendered for it. In the
// demo: 1 286 characters and one image before the patch, 501 and none after,
// triggered by an edit to the *title*. The runtime now writes the rest of the
// document and leaves that subtree standing — it pairs each placeholder with
// the live element in its position and moves it across, descending only while
// the child counts agree, so a page whose markup does not line up gets exactly
// what it got before. The rest is LP0410, the line that names the slug to
// register; without it the reader sees a block that renders in one place and
// not the other, and nothing anywhere says why.
//
// Raised 2026-09-07 (LP-2): raw 98 930 → 99 550 (measured 99 449), gzip 30 918 →
// 31 200 (measured 31 156), brotli 27 500 → 27 680 (measured 27 559).
//
// 2026-09-07 (Z3, escalate instead of degrade): every artifact that embeds the
// runtime rises +1 303 B raw / ~440 B gzip / ~390 B brotli, the lean profile
// +907, measured against the same build without the change. Four things,
// measured apart: the fidelity verdict itself and its LP0411 line 380 B, the
// escalation (fragment when a boundary covers the finding, route otherwise)
// 248 B, the plan-over-chosen-boundaries the escalation shares with
// `planFragments` 131 B, the flush that drains the queue 132 B; the rest is the
// two reporting sites in the writer, the one in the rich-text write, and two
// fields on the runtime state.
//
// What the bytes buy is the difference between "as complete as the annotation"
// and "never worse than the route". The runtime already knew, and threw away,
// three facts: a renderer that refused the value it was handed (LP0402 said so
// and nothing acted on it), a Lexical block whose server markup the write had
// to drop because the two trees do not line up (Z2 left exactly this case
// degrading), and a changed field with no anchor anywhere. Each of those leaves
// the page showing something the server would not have drawn. They now escalate
// to whichever strategy can draw the region, once per element — and a page with
// no strategy at all pays these bytes for nothing but the diagnostic, which is
// the same trade `onUnboundChange` already made and the reason both live in the
// runtime rather than behind the strategy seam.
//
// Raised 2026-09-07 (Z3): raw 99 550 → 100 840 (measured 100 731), gzip 31 200 →
// 31 620 (measured 31 572), brotli 27 680 → 28 090 (measured 27 965).
//
// 2026-09-07 (Z4, merge only when it adds something): every artifact that embeds
// the runtime rises +2 712 B raw / ~830 B gzip / ~700 B brotli, the lean profile
// +2 716, measured against the same build without the change. Two parts, each
// measured on its own by building the change minus that part: the decision
// itself 1 333 B (`src/core/merge-need.ts` — what the page reads, what one
// changed field is worth, and the document carried over from the last answer),
// the window a burst of requests shares 1 013 B, and the remaining 462 B the
// pipeline plumbing both need (the resolved document as its own step, the
// refinement pass, the window on the runtime's dependencies).
//
// What the bytes buy is a request per keystroke. Every accepted message cost one
// authenticated POST to Payload's REST API to have its relationships populated —
// 18 messages, 18 requests, and 19 of them on a page with no binding at all,
// where nobody could read the answer. The runtime now asks only when the answer
// can change what the page shows: a plain text field costs nothing, a page of
// plain scalar bindings costs nothing, and a burst on a relationship or a
// rich-text field costs two requests instead of eighteen — one that opens it,
// one that closes it. That last line must not fall to zero, and the tests
// (`tests/unit/core/merge-need.test.ts`) count it: without a request the page
// would show a document id where its title belongs.
//
// It is in the runtime rather than behind an option because the decision needs
// the binding cache, the message diff and the last resolved document at once,
// and because a page that pays for it is every page: the runtime that does not
// carry it is the one that never merges, and that one has no `dataMerge` and
// makes no request either way. A project that turns the debounce off turns the
// window off with it and keeps the two skips.
//
// Raised 2026-09-07 (Z4): raw 100 840 → 103 550 (measured 103 443), gzip 31 620 →
// 32 450 (measured 32 397), brotli 28 090 → 28 750 (measured 28 630).
//
// 2026-09-07 (Z5, the write that opens a quiet phase): every artifact that
// embeds the runtime rises +172 B raw / ~50 B gzip / ~50 B brotli, measured
// against the same build without the change. It is one timestamp, one
// comparison and one branch in the scheduler, plus the guard that keeps a
// window from flushing a buffer its own leading write already emptied.
//
// What the bytes buy is 50 ms. Until now a keystroke waited out the whole
// debounce before anything reached the DOM — 66.6 ms p95 in the jsdom
// interaction gate, of which 50 was a window with nothing to coalesce, because
// the first message of a quiet phase is alone in it by definition. The first
// write now goes out on the next frame and opens the window that batches the
// rest of the burst: 16.6 ms p95, one animation frame, and the debounce still
// does what it was for. This is only reachable because Z4 took the merge out of
// the common path — a leading write that had to wait for a REST round trip
// would be a frame plus the network, which is what it was replacing.
//
// It is not an option because the choice it makes is not one a page can state
// per edit: the burst a debounce exists for begins with a write that is not yet
// a burst. A page that sets `debounceMs: 0` has no window and is unaffected.
//
// Raised 2026-09-07 (Z5): raw 103 550 → 103 720 (measured 103 615). gzip and
// brotli still hold and stay where Z4 left them — gzip by one byte, which the
// next task in this runtime will have to raise.
// Raised 2026-09-07 (Z6): raw 103 720 → 104 160 (measured 104 051), gzip 32 450 →
// 32 610 (measured 32 568), brotli 28 750 → 28 950 (measured 28 829). The 331 B
// are the trailing run of a refused route refresh and the counter that stops
// calling it a failure. The audit measured two unbound changes 286 ms apart
// against a 1 000 ms minimum interval: one refresh, one refusal, and nothing
// afterwards — an editor who stopped typing there never saw the second change.
// The refusal now asks the runtime to run it once when the window closes, and
// the runtime holds at most one such request, always the newest.
//
// It is in the runtime and not in the prelude because the timer belongs to the
// revision, not to the request: the runtime is what knows whether the revision
// that asked is still the one on screen, and a newer one cancels it.
//
// 2026-09-07 (Z7, LP0201 one level down): every artifact that embeds the
// runtime rises +244 B raw / ~80 B gzip / ~55 B brotli, measured against the
// same build without the change. It is the descent itself — a group the page
// addresses nowhere is opened once and its scalars are named with the path a
// binding would carry — plus the report becoming a function because two call
// sites now share it.
//
// What the bytes buy is a diagnostic that has caught up with the runtime.
// Dotted bindings have worked since 1.x (`venue.title`), and LP0201 looked at
// the top level only: an edit to `admission.priceFrom` stayed invisible in the
// preview and `orphanFields` never named it — the audit read
// `[endsAt, generateSlug, slug, startsAt, state]` and had to find the real
// cause by hand. The descent stops at one level and skips arrays, because
// deeper the shape is a rich-text tree more often than a group and a missing
// anchor inside an array is a template decision.
//
// It costs what it costs in every page because the diagnostic is in the update
// pipeline, where the message and the binding cache meet; there is no seam
// behind which a page could leave it. The restraint that keeps it small is also
// the one that keeps it honest: only a group `createFieldAddressability` already
// calls unaddressable is opened, which is the same field `onUnfaithfulPatch`
// escalates on, so the two cannot drift apart.
//
// Raised 2026-09-07 (Z7): raw 104_160 → 104_410 (measured 104_295), gzip
// 32_610 → 32_690 (measured 32_641). Brotli holds at 91 B of cushion.
//
// 2026-09-07 (Z22, an item rebuilt from a template keeps what the template
// cannot carry): the full inline profile rises +448 B raw / ~157 B gzip /
// ~105 B brotli, the lean profile +25, measured against the same build without
// the change. The 25 are the attribute rule becoming a shared predicate
// (`isWritableAttribute`); the lean profile carries neither array renderer, so
// it pays for the rule and nothing for the fix.
//
// What the bytes buy is the one class of defect the runtime cannot detect by
// itself. Every escalation Z3 added hangs on a write that could not be made;
// here the write succeeds — the list is rebuilt, correctly — and still differs
// from what the server would have sent, because the framework's scoped-style
// marker (`data-astro-cid-…`, `data-v-…`, Svelte's class) lives in the markup
// the compiler wrote and not in the author's item template. The fidelity oracle
// measured it on the Astro fixture: the patched `<ul data-payload-field="tags">`
// was styled differently from the server's, and nothing in the runtime could
// notice, because noticing needs the server's version. The rebuilt item now
// inherits what every item in the list already carried, minus what no write of
// ours may set. Naming no framework is the point: what identifies these
// attributes is that the whole list has them with the same value.
//
// The exception in `tests/fixtures/fidelity-corpus.ts` is deleted, and the
// oracle is green without it — a difference that stopped happening fails the
// gate as loudly as a new one, so this is the acceptance and not a claim.
//
// Raised 2026-09-07 (Z22): raw 104_410 → 104_860 (measured 104_743), gzip
// 32_690 → 32_845 (measured 32_798), brotli 28_950 → 29_090 (measured 28_964).
//
// Raised 2026-09-10 (Z20): raw 104_860 → 105_700 (measured 105_592), gzip
// 32_845 → 33_170 (measured 33_122), brotli 29_090 → 29_340 (measured 29_212).
// The +851 B raw in every artifact that embeds the runtime is LP0412, and it is
// the most expensive diagnostic in the runtime so far. Nearly a third of it is
// the message itself: it has to print both readings of the same value, because
// the whole finding is that they differ and only a human can say which is right.
//
// What it buys is the oldest entry in the oracle's ledger. A `<time>` bound to
// `publishedAt` shows what the template printed — in all four shipped fixtures
// the stored ISO instant — and the date renderer writes a formatted one over
// it. The patch succeeds, so nothing in Z3's escalation path sees it, and the
// preview stops matching the server without a sound. Z3 measured that
// escalating makes it worse (the route redraws the template's format and the
// re-apply overwrites it again) and that withholding needs a judgement the
// runtime cannot make (the first message may already carry unsaved edits), so
// what is left is to say it, once per binding, before the reading is gone.
//
// The cost is bounded on purpose. The check runs only on the first write to a
// binding a formatting renderer owns (`date`, `number`, `checkbox`) that has no
// `data-payload-format`, so a page of text bindings reads no DOM for it at all,
// and a 5 000-binding page pays one `WeakSet` lookup per binding, once.
// Raised 2026-09-10 (Z9): raw 105_700 → 109_615 (measured 109_505), gzip
// 33_170 → 34_532 (34_482), brotli 29_340 → 30_509 (30_379). +3 913 B raw /
// ~1 360 gzip against Z20 is auto-binding (ADR 0014): the one search on the
// first message — value table, shape rules, the measured floor, the walk with
// its boundaries, per-element uniqueness, the two-fields idioms, the stamping —
// plus the option slot, the marker and two inspection fields. Paid by a page
// that leaves `autoBind` off, because the search needs the cache, locale, owner
// scope and observers, none of which cross the strategy seam; a prelude emitted
// only for a page that turns it on is the way to get the bytes back.
// Lowered 2026-09-10 (Z25): raw 109_615 → 108_328 (measured 108_218), gzip
// 34_532 → 34_010 (33_960), brotli 30_509 → 30_061 (29_931). The −1 287 B raw
// is the frozen diagnostic-code table, which had shipped in every page since
// Z6: one `DIAGNOSTIC_CODES.UnboundChangeRefresh` read in the strategy runner
// pulled the whole record in, against the rule in the registry's own header.
// The site writes the literal now, like every other browser-side site, and a
// test holds the artifact free of the table's rows. The lean profile never
// carried it — it has no strategy runner — and does not move.
// Raised 2026-09-10 (Z26): raw 108_328 → 109_249 (measured 109_128), gzip
// 34_010 → 34_313 (34_258), brotli 30_061 → 30_290 (30_142). The +910 B raw
// is what a route refresh needs to keep the guesses auto-binding made: the
// fresh markup carries no stamp, so the search runs once more over it — for
// the fields the baseline bound, by the value each was found by and by the
// revision's value, and for nothing else (ADR 0014, Consequences). A stamp
// that survives the morph would have been cheaper and is wrong: the morph
// pairs unkeyed siblings by position, and a paragraph the server inserted took
// the guess with it. Paid by a page with `autoBind` off, for Z9's reason.
// Lowered 2026-09-11 (Z28): raw 109_249 → 108_432 (measured 108_311), gzip 34_313 → 34_173
// (34_118), brotli 30_290 → 30_253 (30_105). The −817 B raw are lines the trusted core's
// own mutation run showed no test could reach, now gone: the merger's abort-
// signal check the attempt counter already implies, its unreachable
// collection-slug fallback and `encodeURIComponent` probes, the bus's repeated
// generation checks and its array-with-compaction queue (a linked list now),
// the escape helpers' empty-string fast paths, the URL validator's pre-trim
// empty check and the guard `isExternalHttpUrl` implied itself, and the
// sanitizer's unwrap loop (`replaceWith`). Behaviour is unchanged; the tests
// that hold each removed line's property are in the same commit.
// Raised 2026-09-11 (Z30): raw 108_432 → 109_196 (measured 109_075), gzip 34_173 → 34_353
// (34_298), brotli 30_253 → 30_350 (30_202). The +764 B raw is the line about a
// block nobody registered a renderer for, spoken where it can be true. LP0410
// was reported by the node renderer while it produced the placeholder — before
// the write knew whether the pairing would find the server's markup — so on a
// page where it did not, the console said "keeping what the server rendered"
// while the image was being deleted (measured on the demo, Z30). The renderer
// now only names the slug through the render context (`onUnrenderedBlock`, one
// context per document instead of a shared one), and the write judges each
// placeholder once it has moved what it could: LP0410 where a live element
// took the placeholder's place, the new LP0413 where one is still standing
// over markup the element had, and no line where there was nothing to keep.
// The second verdict is what `reportUnfaithful` was already told; it now also
// reaches the console. The rest is `inspect().fidelity` — three counters in the
// runtime state (`unfaithful`, `escalated`, the field names), counted before
// the mode decides anything, so a page with no strategy shows the gap.
// Raised 2026-09-11 (Z29): raw 109_196 → 109_498 (measured 109_368), gzip 34_353 → 34_447
// (34_391), brotli 30_350 → 30_432 (30_270). The +293 B raw is the wrapper the
// block-keeping write (LP-2, above) could not see. It pairs the bound element's
// children with the rendered document's positionally and stops where the
// counts disagree — and a template's `<div class="prose">` around the field is
// one child where the document has five, so on the demo post the pairing
// stopped there and the image went after an edit to the title, exactly as
// before LP-2 (Z29, measured on the demo). The write now finds that wrapper,
// pairs inside it and writes into it, so the wrapper and the classes the
// typography hangs on stay. The bytes are the recognition and its two guards:
// only a `div`, `section` or `article` (Lexical renders content as none of
// them — a lone paragraph gaining a sibling is not a wrapper), and unlike
// every top-level element of the rendered document by tag and class (a `<div>`
// a registered block renders is content, and the paragraph typed after it
// lands beside it). A single rendered element decides nothing; the positional
// pairing already keeps a lone server-rendered block whole.
// Raised 2026-09-11 (Z27): raw 109_498 → 111_423 (measured 111_293), gzip 34_447 → 35_158
// (35_102), brotli 30_432 → 31_094 (30_932). The +1 925 B raw is the wait for
// React (ADR 0015). On a Next page the runtime started on `DOMContentLoaded`,
// posted `ready`, and wrote the admin's document 81 ms before React walked the
// server markup; React threw `Hydration failed`, regenerated the tree and
// dropped the write, once per load — the mock admin's replay loop was what
// kept the fixture green. The runtime now reads a new wire slot, `hydration:
// 'react'`, that the Next adapter sets, and under it does not start until
// React has committed a root that holds a binding, observed through the hook
// React injects into (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, wrapped if a DevTools
// extension owns it), capped at 5 s with LP0607. The bytes: the hook, the
// recorder the asset bootstrap shares with it and the commit judgement
// (`hydration.ts`), the two-stage start the lifecycle handed to `startup.ts`
// when it crossed 500 lines, the cap message, and `inspect().hydration`.
// Every profile pays it: the wait sits in `start()`. Pressed once on the way:
// the first draft measured +1 633 with a hook that lacked the `renderers` map
// Fast Refresh walks — and that hook stopped the Next fixture from hydrating
// at all, so the map and a per-renderer id came back for +290.
// Raised 2026-09-11 (merge of main #64/#65): raw 112_508 → 112_943 (measured
// 112_813), gzip 35_490 → 35_658 (35_602) — the measured difference, cushions kept.
// Raised 2026-09-11 (Z31): raw 111_423 → 112_508 (measured 112_378), gzip 35_158 → 35_490
// (35_434), brotli 31_094 → 31_376 (31_214). The +1 085 B raw is the wait for Vue
// (ADR 0015, addendum). On a Nuxt page the runtime wrote the admin's document
// at 25 ms and Vue's hydration repaired every value back to the server's at
// 94 ms, quietly; what mended it was the mock admin answering the runtime's
// second `ready`, which Payload's admin does not. The Nuxt adapter now sets
// `hydration: 'vue'`, the second value of Z27's slot, and under it the
// runtime does not start until Vue has mounted the app around a binding: an
// accessor on `Element.prototype` for the `__vue_app__` property Vue assigns
// as `mount()` returns, the walk a late runtime makes up from its first
// binding, and the Suspense wait for a Nuxt app still hydrating at the mount
// (`hydration-vue.ts`); cap and waiters are shared with React's wait. The
// bytes are Vue's and Nuxt's names and the accessor's property calls, which
// no minifier shortens. Every profile pays it: the wait sits in `start()`.
// Raised 2026-09-12 (Testlauf B, F1): raw 112_943 → 113_230 (measured 113_126),
// gzip 35_658 → 35_739 (35_688), brotli 31_514 → 31_620 (31_466) — the measured
// difference in each metric, cushions kept. The +287 B raw
// is the second cause of an unfaithful patch reaching the ledger: a changed
// field with no binding anywhere. The decision was already made on every
// revision that could refresh; what is new is that it is made under every mode
// and on a page with no strategy, and that each field it finds is recorded once.
// `inspect().fidelity` used to answer `0` for exactly the page it was written
// for — one that binds little, edits much and has nowhere to escalate to.
// Raised 2026-09-12 (B-01): raw 113_330 → 113_506 (measured 113_410), gzip
// 35_739 → 35_788 (35_777) — the measured difference, cushions kept. The +176 B
// raw is the fix for a row that lacks one of the template's fields: it wrote the
// placeholder into the page, which is what an editor saw the moment they added a
// row. A placeholder no row can fill is still written out, because that one is a
// typo in the template.
// The entry rows in entry-budgets.ts move with the same change and are recorded
// here, because that log sits on its 500-line limit: `core.*` and `client.*`
// +203 B raw, the two barrels +379, `structural.*` +182, every adapter +176,
// and the gzip rows by their own measured difference. That file's numbers were
// raised by exactly the difference between a build of this tree without the
// change and one with it, so none of it is this host's drift.
export const INLINE_BUDGET = { raw: 113_506, gzip: 35_788, brotli: 31_620 } as const;

// The lean profile, the same runtime with its optional halves left out, keeps
// its budget and its log in bundle-lean-budgets.ts: this log reached the
// 500-line limit a third time, and a split by profile keeps every note next to
// the number it explains.
export { INLINE_LEAN_BUDGET } from './bundle-lean-budgets';

// The two prelude profiles, each the runtime plus a prelude that moves on its own,
// keep their budgets and their log in bundle-prelude-budgets.ts: this log reached
// the 500-line limit a second time, and a split by profile keeps every note next
// to the number it explains.
export { INLINE_FRAGMENT_BUDGET, INLINE_ROUTE_BUDGET } from './bundle-prelude-budgets';
