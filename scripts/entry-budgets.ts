/**
 * The per-entry byte budgets, and the log of why each number is what it is.
 *
 * Its own module because the log is the point: every raise carries a date and a
 * reason in the reviewer's words, and a table that long crowds out the checker
 * that reads it (files stay under 500 lines).
 */

import type { BundleBudget } from './bundle-budgets';

// Budgets include narrow headroom for patch-level correctness fixes while still
// failing the unminified 1.0.4 artifacts. Public names and source maps are retained.
export const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
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
  'annotate.js': { raw: 2_950, gzip: 1_544, brotli: 1_380 },
  'adapters/astro/index.js': { raw: 144_279, gzip: 44_901, brotli: 38_808 },
  'adapters/astro/middleware-entry.js': { raw: 130_927, gzip: 40_778, brotli: 35_247 },
  'adapters/nextjs/index.js': { raw: 142_535, gzip: 44_389, brotli: 38_391 },
  //
  // 2026-09-06 (`./react`, `./vue`): two new rows, measured at 14 045 / 13 814
  // raw and 4 637 / 4 621 gzip. Both entries carry the message bus, the origin
  // detector and the merger — the document half of the runtime — and nothing
  // that touches an element, which is why each is a third of an adapter row.
  // They share every module but their reactivity, hence the near-identical
  // figures.
  'adapters/react/index.js': { raw: 14_250, gzip: 4_700, brotli: 4_260 },
  'adapters/vue/index.js': { raw: 14_000, gzip: 4_690, brotli: 4_220 },
  //
  // 2026-09-06 (R4, zero-config setup): one new row. `adapters/nuxt/module.js`
  // is the build-time Nuxt module — a few hundred bytes, because all it does is
  // write a plugin into `.nuxt/` and register its path; the runtime it pulls in
  // is the existing `./nuxt` entry, which the generated plugin imports. The Next
  // row rises ~700 B gzip for `withLivePreview()`: the header rules and the
  // frame-ancestors builder it shares with the middleware.
  'adapters/nuxt/module.js': { raw: 660, gzip: 426, brotli: 349 },
  'adapters/nuxt/index.js': { raw: 142_000, gzip: 44_263, brotli: 38_293 },
  'adapters/sveltekit/index.js': { raw: 141_023, gzip: 43_998, brotli: 38_011 },
  //
  // 2026-09-06 (Ü12): the codegen rows carry the annotator — the template
  // scanner, its refusal reasons and the `annotate` subcommand. It is a build
  // tool; no page and no adapter bundle sees any of it.
  'codegen-astro.js': { raw: 12_950, gzip: 4_550, brotli: 4_100 },
  'codegen-cli.js': { raw: 20_100, gzip: 6_950, brotli: 6_270 },
  'codegen.cjs': { raw: 15_300, gzip: 5_400, brotli: 4_890 },
  'codegen.js': { raw: 15_200, gzip: 5_380, brotli: 4_890 },
  'doctor-cli.js': { raw: 33_150, gzip: 12_140, brotli: 10_780 },
  'doctor.js': { raw: 13_183, gzip: 5_507, brotli: 4_803 },
  'migrate.js': { raw: 13_350, gzip: 4_800, brotli: 4_320 },
  'core.cjs': { raw: 117_781, gzip: 36_972, brotli: 32_125 },
  'core.js': { raw: 117_248, gzip: 36_895, brotli: 32_102 },
  'index.cjs': { raw: 250_671, gzip: 76_968, brotli: 49_801 },
  'index.js': { raw: 250_049, gzip: 76_964, brotli: 49_744 },
  // The two smallest entries are budgeted to 5 bytes rather than 50: at ~1 KB a
  // 50-byte step is 5 % of the artifact, which stops being a budget.
  'payload.cjs': { raw: 1_090, gzip: 575, brotli: 515 },
  'payload.js': { raw: 1_080, gzip: 575, brotli: 515 },
  // Measured 2026-08-27 (12465/4730/4307 and 12292/4670/4212), ~1 % headroom.
  // 2026-09-06 (R8): +~110 B raw for `previewBindingsFromLocals`, the one-line
  // helper the build-time annotator writes a call to.
  'server.cjs': { raw: 12_950, gzip: 4_780, brotli: 4_310 },
  'server.js': { raw: 12_830, gzip: 4_775, brotli: 4_300 },
  'client.cjs': { raw: 111_985, gzip: 34_891, brotli: 30_437 },
  'client.js': { raw: 111_912, gzip: 34_879, brotli: 30_411 },
  'structural.cjs': { raw: 19_414, gzip: 6_859, brotli: 6_218 },
  'structural.js': { raw: 19_368, gzip: 6_858, brotli: 6_213 },
  'lean.cjs': { raw: 81_454, gzip: 25_607, brotli: 22_776 },
  'lean.js': { raw: 81_443, gzip: 25_602, brotli: 22_768 },
  'lexical.cjs': { raw: 16_371, gzip: 5_619, brotli: 5_088 },
  'lexical.js': { raw: 16_343, gzip: 5_627, brotli: 5_087 },
  //
  // 2026-09-06 (Ü10): `plugins.*` rise ~2 900 raw / ~1 150 gzip for the
  // unbound-fields overlay — the development panel that lists the fields an
  // update carried and the page cannot show. It is a plugin precisely so this
  // row moves and `INLINE_BUDGET` does not: no page carries it unless its own
  // code asks for it.
  'plugins.cjs': { raw: 18_600, gzip: 6_880, brotli: 6_050 },
  'plugins.js': { raw: 18_600, gzip: 6_880, brotli: 6_050 },
  'fragment.cjs': { raw: 13_950, gzip: 5_380, brotli: 4_740 },
  'fragment.js': { raw: 13_900, gzip: 5_360, brotli: 4_720 },
};
