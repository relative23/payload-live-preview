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
// Raised 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 35 788 → 35 801 (+13 B, measured 35 783 → 35 796).
// Raised 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 113 506 → 113 555 (+49 B, measured 113 479 → 113 528); gzip 35 801 → 35 814 (+13 B, measured 35 796 → 35 809).
// Raised 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 35 814 → 35 819 (+5 B, measured 35 809 → 35 814).
// 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 113 555 → 113 996 (+441 B, measured 113 545 → 113 986); gzip 35 819 → 35 928 (+109 B, measured 35 814 → 35 923); brotli 31 620 → 31 689 (measured 31 602 → 31 629, cushion kept).
// 2026-09-18 (2.0.3, the release build): brotli is not byte-stable — CI compressed index.js 2 B over a budget that kept 46 B over the local figure; every brotli row now keeps ~120 B (or under the 2 % notice on a small file) and every gzip row at least 12 B over this host's 2.0.3 measurement: brotli 31 689 → 31 798 (measured 31 678).
// 2026-09-18 (2.0.4, diagnostics that say what the page does): raw 113_996 → 114_908 (+912 B), gzip 35_928 → 36_239 (+311 B), brotli 31_798 → 31_998 (+200 B) — the difference between a build of this tree without the change and one with it, cushions kept. The bytes are two console lines and the branch that picks them: a field with no binding says LP0203 when it came with a value and keeps LP0201 for the empty one; `onUnfaithfulPatch: 'escalate'` with no strategy says so once (LP0808); `inspect().fidelity.canEscalate` reports whether a strategy exists. The entry rows in entry-budgets.ts move with the same change and are recorded here (raw / gzip / brotli), that file being at its line limit: `adapters/astro/index.js` +917 / +321 / +254, `adapters/astro/middleware-entry.js` +917 / +318 / +256, `adapters/nextjs/index.js` +917 / +324 / +238, `adapters/nuxt/index.js` +917 / +323 / +166, `adapters/sveltekit/index.js` +917 / +316 / +246, `client.cjs` +955 / +321 / +255, `client.js` +955 / +321 / +247, `codegen.cjs` -740 / -240 / -222, `codegen.js` -740 / -233 / -226, `core.cjs` +955 / +326 / +254, `core.js` +955 / +321 / +290, `doctor-cli.js` +53 / +20 / +14, `doctor.js` +53 / +18 / +23, `fragment.cjs` +53 / +18 / +27, `fragment.js` +53 / +17 / +18, `index.cjs` +1872 / +623 / +364, `index.js` +1872 / +632 / +282, `lean.cjs` +431 / +166 / +122, `lean.js` +431 / +166 / +170, `plugins.cjs` +53 / +17 / +3, `plugins.js` +53 / +15 / +14. `codegen.*` falls by the dead `checkPreviewBindings` it no longer carries; the tool rows carry the two codes in the registry.
// 2026-09-19 (focus survives a keyed move in a structural list): raw 114_908 → 114_932 (+24 B), gzip 36_239 → 36_256 (+17 B), brotli 31_998 → 31_985 (-13 B) — the difference between a build of main and this branch, cushions kept. The bytes are the structural applier capturing the focused element before its commit and restoring it after: placing a retained item is a remove-and-insert, which blurred a control the visitor was typing into (ADR 0008 §1, found by the morph contract suite in three browsers). The lean profile carries no structural arrays and does not move. The entry rows in entry-budgets.ts move with the same change and are recorded here (raw / gzip / brotli), that file being at its line limit: `adapters/astro/index.js` +24 / +24 / +8, `adapters/astro/middleware-entry.js` +24 / +19 / +46, `adapters/nextjs/index.js` +24 / +23 / +6, `adapters/nuxt/index.js` +24 / +22 / +2, `adapters/sveltekit/index.js` +24 / +21 / +0, `client.cjs` +18 / +26 / -23, `client.js` +18 / +25 / +85, `core.cjs` +18 / +21 / +38, `core.js` +18 / +19 / +34, `index.cjs` +42 / +30 / -22, `index.js` +42 / +45 / +19, `structural.cjs` +23 / +11 / +8, `structural.js` +23 / +8 / +14.
// 2026-09-19 (the sanitizer empties `is`): raw 114_932 → 114_973 (+41 B), gzip 36_256 → 36_264 (+8 B), brotli 31_985 → 32_006 (+21 B) — the difference between a build of main and this branch, cushions kept. The bytes are one branch in the sanitizer: a parsed element's `is` value is immutable and the serialiser writes it back after the attribute is removed, so removing it handed the re-parse the page's customised built-in by name; the attribute is emptied instead (found by the XSS corpus, ADR 0016). Every row that carries the sanitizer moves: the runtime rows, `lean.*`, `lexical.*` and `structural.*`. The entry rows in entry-budgets.ts move with the same change and are recorded here (raw / gzip / brotli), that file being at its line limit: `adapters/astro/index.js` +41 / +9 / +54, `adapters/astro/middleware-entry.js` +41 / +12 / +24, `adapters/nextjs/index.js` +41 / +9 / +19, `adapters/nuxt/index.js` +41 / +10 / +68, `adapters/sveltekit/index.js` +41 / +12 / +64, `client.cjs` +41 / +13 / +21, `client.js` +41 / +14 / +5, `core.cjs` +41 / +13 / -11, `core.js` +41 / +11 / -14, `index.cjs` +82 / +29 / +86, `index.js` +82 / +24 / +11, `lean.cjs` +41 / +8 / -25, `lean.js` +41 / +9 / +83, `lexical.cjs` +41 / +13 / +11, `lexical.js` +41 / +13 / +13, `structural.cjs` +41 / +17 / +11, `structural.js` +41 / +16 / +13.
// 2026-09-19 (2.1: the sanitizer document named per call): raw 114_973 → 115_036 (+63 B), gzip 36_264 → 36_293 (+29 B), brotli 32_006 → 32_001 (-5 B) — the difference between a build of main and this branch, cushions kept. The bytes are one operand: `options.document` wins over the process-wide slot when the sanitizer resolves its DOM, and the Lexical renderer hands its own `document` option through. Every row that carries the sanitizer or the renderer moves. The entry rows in entry-budgets.ts move with the same change and are recorded here (raw / gzip / brotli), that file being at its line limit: `adapters/astro/index.js` +63 / +23 / +64, `adapters/astro/middleware-entry.js` +63 / +27 / +10, `adapters/nextjs/index.js` +63 / +27 / +16, `adapters/nuxt/index.js` +63 / +25 / -12, `adapters/sveltekit/index.js` +63 / +29 / +5, `client.cjs` +83 / +24 / -41, `client.js` +83 / +24 / +1, `core.cjs` +71 / +23 / -3, `core.js` +71 / +20 / +1, `index.cjs` +134 / +43 / +46, `index.js` +134 / +47 / +11, `lean.cjs` +63 / +21 / -4, `lean.js` +63 / +21 / +4, `lexical.cjs` +633 / +173 / +164, `lexical.js` +633 / +178 / +157, `structural.cjs` +13 / +6 / +5, `structural.js` +13 / +7 / +4.
// 2026-09-19 (2.1: one scope per runtime session): raw 115_036 → 115_550 (+514 B), gzip 36_293 → 36_489 (+196 B), brotli 32_001 → 32_196 (+195 B) — the difference between a build of main and this branch, cushions kept. The bytes are the session scope: the runtime opens a ResourceScope per session (the plugin registrations' class, now in src/core) and hands it the teardown, so destroy(), suspend() and a failed start release the same way; the hand-written cleanup list and its guard go, a minimal LifetimeScope class comes into the runtime bundle (ADR 0005, 2.1 note). The lean profile carries the runtime and moves with it. The entry rows in entry-budgets.ts move with the same change and are recorded here (raw / gzip / brotli), that file being at its line limit: `adapters/astro/index.js` +514 / +195 / +54, `adapters/astro/middleware-entry.js` +514 / +195 / +192, `adapters/nextjs/index.js` +514 / +199 / +125, `adapters/nuxt/index.js` +514 / +196 / +187, `adapters/sveltekit/index.js` +514 / +193 / +194, `client.cjs` +322 / +142 / +184, `client.js` +322 / +141 / +126, `core.cjs` +322 / +133 / +171, `core.js` +322 / +142 / +153, `index.cjs` +836 / +344 / +233, `index.js` +836 / +352 / +182, `lean.cjs` +514 / +195 / +198, `lean.js` +514 / +196 / +215.
// 2026-09-22 (2.1: the morph takes its ownership rule): raw 115_550 → 115_503 (measured −47 B), gzip 36_489 → 36_492 (+3 B), brotli 32_196 → 32_261 (measured +27 B, then restored to 120 B over this host). Moving the package predicate beside the island rule lets a coordinator replace or extend it; one decision in `morphElement` now retains compatible owned roots and replaces incompatible keyed boundaries, so the root and child paths agree with ADR 0008 §4. Main and branch were built with the same `SOURCE_DATE_EPOCH`; raw and gzip cushions are kept, and brotli rows below ~120 B regain it for the commit-epoch change. The two small fragment entries keep their prior 91 B instead, below the 2 % improvement notice as this budget's header requires.
// The entry rows in entry-budgets.ts move by these measured differences (raw / gzip / brotli): `adapters/astro/index.js` −123 / −318 / +18, `adapters/astro/middleware-entry.js` −123 / −317 / −115, `adapters/nextjs/index.js` −123 / −312 / −33, `adapters/nuxt/index.js` −123 / −308 / −96, `adapters/sveltekit/index.js` −123 / −309 / −128, `client.cjs` −32 / +31 / +16, `client.js` −32 / +31 / +63, `core.cjs` −32 / +25 / +23, `core.js` −32 / +28 / +6, `fragment.cjs` −31 / +8 / −5, `fragment.js` −31 / +15 / +20, `index.cjs` −155 / −258 / −61, `index.js` −155 / −273 / +6, `structural.cjs` +56 / +35 / +29, `structural.js` +66 / +40 / +35. The default inline profile is −47 / +3 / +27; route and fragment profiles are recorded beside their rows.
// 2026-09-22 (2.1: exact fragment response identity): the fragment prelude moves +19 B raw / +0 gzip / +64 brotli. The client now compares the echoed key with the requested key and gives absent and empty internal keys distinct request identities, so mismatched server HTML cannot reach the morph. The comparison used the same dirty morph tree and `SOURCE_DATE_EPOCH`, with only those two handler changes removed. Entry deltas (raw / gzip / brotli), with their existing cushions preserved: `adapters/astro/index.js` +19 / +6 / −19, `adapters/astro/middleware-entry.js` +19 / +6 / −30, `adapters/nextjs/index.js` +19 / +5 / +55, `adapters/nuxt/index.js` +19 / +3 / −15, `adapters/sveltekit/index.js` +19 / +6 / +6, `fragment.cjs` +19 / +3 / +18, `fragment.js` +19 / +6 / −16, `index.cjs` +19 / +4 / −140, `index.js` +19 / +3 / −103. The default and route inline profiles do not carry the fragment client and stay fixed; the fragment-profile row is recorded in bundle-prelude-budgets.ts.
// 2026-09-23 (H03: the fragment request is bounded while it is read): only the four server-adapter entries move. The shared endpoint now counts consumed bytes instead of UTF-16 code units after full buffering, stops an acquired reader at the cap, gives the whole body read one deadline and validates both limits before serving. A declared over-limit length refuses before acquiring or cancelling the stream so SvelteKit can write the 413 instead of destroying its Node request. Against the H06 V025 build at the same commit epoch, measured deltas (raw / gzip / brotli) are `adapters/astro/index.js` +1_774 / +573 / +462, `adapters/nextjs/index.js` +1_774 / +583 / +423, `adapters/nuxt/index.js` +1_774 / +586 / +517 and `adapters/sveltekit/index.js` +1_772 / +581 / +513. The rows in entry-budgets.ts rise by exactly those differences, preserving their existing raw, gzip and roughly 120 B brotli cushions.
// 2026-09-23 (H08: managed head as an ordered multiset): the route code adds +254 / +54 / +36 to its inline profile and +254 / −19 / −112 to the fragment profile. Entry deltas (raw / gzip / brotli) are `adapters/astro/index.js` +508 / +532 / +203, `adapters/astro/middleware-entry.js` +508 / +525 / +255, `adapters/nextjs/index.js` +508 / +521 / +221, `adapters/nuxt/index.js` +508 / +524 / +197, `adapters/sveltekit/index.js` +508 / +507 / +216, `fragment.cjs` +228 / +74 / +63, `fragment.js` +228 / +68 / +65, `index.cjs` +508 / +515 / +182 and `index.js` +508 / +507 / +323. It buys duplicate metadata, full stale-attribute removal, deterministic order and owner preservation; measured alone against the H03 snapshot with one commit epoch.
// 2026-09-23 (H14: aborted waiters leave the fragment gate): on the H08 tree the fragment profile adds +525 / +189 / +184. Entry deltas are `adapters/astro/index.js` +525 / +132 / +162, `adapters/astro/middleware-entry.js` +525 / +139 / +118, `adapters/nextjs/index.js` +525 / +143 / +174, `adapters/nuxt/index.js` +525 / +141 / +138, `adapters/sveltekit/index.js` +525 / +138 / +135, `fragment.cjs` +530 / +186 / +177, `fragment.js` +530 / +186 / +185, `index.cjs` +525 / +135 / +171 and `index.js` +525 / +135 / +105. These bytes remove cancelled queued work and close the permit-handoff abort race; they do not claim to stop server CPU. Every affected row moves by the measured delta and keeps its prior cushion.
// 2026-09-23 (H06: fragment request generation identity): the signal generation joins the request dedupe key, so a later runtime or owner generation that reuses the same public revision cannot inherit the earlier generation's promise. The fragment profile moves +96 / +46 / +96. Entry deltas (raw / gzip / brotli) are `adapters/astro/index.js` +96 / +43 / +9, `adapters/astro/middleware-entry.js` +96 / +39 / +42, `adapters/nextjs/index.js` +96 / +39 / +37, `adapters/nuxt/index.js` +96 / +36 / +83, `adapters/sveltekit/index.js` +96 / +38 / +24, `fragment.cjs` +119 / +36 / +24, `fragment.js` +119 / +42 / +44, `index.cjs` +96 / +39 / +37 and `index.js` +96 / +42 / +46. The default and route profiles do not carry the fragment client. Every affected row moves by the measured delta and keeps its prior cushion.
// 2026-09-24 (2.1, router-commit replay): the runtime profiles add 904 raw bytes. Their measured gzip deltas are 205 to 210 bytes and brotli deltas are 142 to 198 bytes. Adapter and entry rows move by the exact paired-build differences recorded below; existing cushions stay unchanged. The bytes invalidate work owned by the old route, establish a navigation replay baseline, defer Astro's initial page-load listener, and carry framework route-commit facts without static framework imports.
// Entry deltas (raw / gzip / brotli): `adapters/astro/index.js` +1_103 / +257 / +270, `adapters/astro/middleware-entry.js` +1_094 / +248 / +219, `adapters/nextjs/index.js` +1_104 / +245 / +285, `adapters/nuxt/index.js` +1_104 / +248 / +228, `adapters/sveltekit/index.js` +1_201 / +298 / +354, `client.cjs` +620 / +103 / +90, `client.js` +620 / +104 / +94, `core.cjs` +620 / +109 / +72, `core.js` +620 / +99 / +109, `doctor-cli.js` +23 / +13 / +9, `doctor.js` +23 / +12 / +20, `index.cjs` +1_867 / +429 / +247, `index.js` +1_867 / +421 / +280, `lean.cjs` +904 / +206 / +202 and `lean.js` +904 / +205 / +91.
// 2026-09-24 (2.1 source freeze): the owner-scoped fragment and island paths,
// late-stream discovery, and re-entrancy guards measure 124_979 raw / 39_149
// gzip / 34_318 brotli together. The ceiling keeps 10 B raw, 5 B gzip and the
// documented 120 B brotli cushion. The lean, route and fragment measurements
// sit beside their rows; runtime-carrying package entries move to the same
// final build in entry-budgets.ts.
// 2026-09-24 (H03, SvelteKit's 413 survives a chunked over-limit body): the
// shared endpoint lets that transport drain discarded bytes under the existing deadline instead of mapping cancellation to a socket reset. Paired package-copy measurements (raw / gzip / brotli) are Astro +126 / +63 / +29, Next.js +126 / +55 / +59, Nuxt +126 / +66 / +63 and SvelteKit +138 / +60 / +21. Only these four server entries move; entry-budgets.ts keeps its existing raw/gzip cushions and restores about 120 B for brotli.
// 2026-09-24 (streamed React hydration): raw 124_979 → 125_475 (+496 B),
// gzip 39_149 → 39_285 (+136 B), brotli 34_318 → 34_451 (+133 B).
// The React commit judge now keeps the FiberRoot, walks its current tree and
// waits while a root-wide Suspense or Activity server boundary is dehydrated;
// the first partial App Router commit can no longer release the initial admin
// document into markup React will regenerate. Paired builds used the same
// 2.1 tree and commit epoch; the prior 10 B raw, 5 B gzip and 120 B brotli
// cushions stay unchanged. Profile and entry deltas are recorded beside their
// rows; the plain loader remains 431 B and the armed React loader shrinks
// 1_036 → 1_013 B because it records the root instead of its container.
// 2026-09-24 (H01 route fidelity): raw 125_475 → 125_530 (+55 B), gzip
// 39_285 → 39_308 (+23 B), brotli 34_451 → 34_456 (+5 B). The built-in route
// strategy now distinguishes a snapshot-free render from one proven to know
// the current unsaved revision and exposes that count through inspection.
// Paired builds used this working tree and one commit epoch; all prior cushions
// remain. Entry deltas (raw / gzip / brotli): Astro +47 / +18 / +19,
// middleware +47 / +24 / -6, Next.js +47 / +21 / +55, Nuxt +47 / +23 / -12,
// SvelteKit +47 / +21 / -2, client.cjs +55 / +27 / +47, client.js +55 / +25 /
// +26, core.cjs +55 / +25 / +45, core.js +55 / +25 / -32, index.cjs +102 /
// +51 / +30 and index.js +102 / +45 / -44.
// 2026-09-25 (H11, ADR 0004 §4c): explicit response-identity guards add
// 282 raw / 72 gzip / 80 brotli to the default inline script. The lean,
// route and fragment profiles add the same 282 raw and 75–84 gzip. Paired
// builds use the same HEAD epoch; prior raw/gzip cushions remain, brotli keeps
// at least 120 B. Merger-bearing entries add 60–96 gzip (root 145–148 because
// it carries both source and embedded runtime). No unchanged entry moves.
// 2026-09-27 (PHD-05): guarded fragment-only island handoff and per-snapshot
// deduplication. Measured +167/+100/+78 B raw/gzip/brotli against the retained
// source-built archive; preserve the 10/5/120 B cushions.
// 2026-09-28 (H05 fragment islands, ADR 0021): measured +1991/+611/+489 B; same 10/5/120 B cushions.
export const INLINE_BUDGET = { raw: 127_980, gzip: 40_096, brotli: 35_223 } as const;

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
