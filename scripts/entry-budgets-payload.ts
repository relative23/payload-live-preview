/**
 * Byte budgets for the Payload configuration entries.
 * They stay separate because the main historical ledger is at its line limit.
 */
import type { BundleBudget } from './bundle-measure';

export const PAYLOAD_ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // The two smallest entries are budgeted to 5 bytes rather than 50: at ~1 KB a
  // 50-byte step is 5 % of the artifact, which stops being a budget.
  // 2026-09-23 (Payload 2 callback shape): `documentInfo` routing moves CJS
  // 1 090 / 576 / 516 → 1 205 / 618 / 553 (measured 1 200 / 613 / 548) and
  // ESM 1 080 / 575 / 515 → 1 197 / 610 / 547 (1 192 / 605 / 542).
  // 2026-09-24 (last-value preview intent): CJS measured 1 219 / 624 / 559
  // and ESM 1 211 / 617 / 549; each dimension keeps the entry's 5 B cushion.
  // 2026-09-24 (Payload 3's non-localized callback and encoded custom query
  // key): CJS measured 1 264 / 643 / 564 and ESM 1 256 / 636 / 555. The
  // tolerant locale guard keeps the upstream `{ code: undefined }` value from
  // hiding Live Preview, and encoding keeps a configured parameter one key.
  // Each dimension retains the entry's five-byte cushion.
  // 2026-11-24 (the base loses its trailing slashes in a loop, not by `/\/+$/`): paired
  // Node22.23.2; CJS +23 / +10 / +13 to 1 287 / 653 / 577 and ESM +23 / +10 / +14 to
  // 1 279 / 646 / 569; each dimension keeps its five bytes.
  'payload.cjs': { raw: 1_292, gzip: 658, brotli: 582 },
  'payload.js': { raw: 1_284, gzip: 651, brotli: 574 },
  // 2026-09-23 (`./plugin`): new Payload config entry, measured at
  // 2 263 / 1 043 / 944 CJS and 2 255 / 1 038 / 929 ESM. Like `./payload`,
  // each dimension carries five bytes rather than a percentage-sized step.
  // 2026-09-24 (last-value preview intent): CJS measured 2 282 / 1 053 / 955
  // and ESM 2 274 / 1 049 / 942; the same 5 B cushion is retained.
  // 2026-09-24 (Payload 3's non-localized callback and encoded custom query
  // key): CJS measured 2 327 / 1 073 / 966 and ESM 2 319 / 1 067 / 953;
  // each dimension retains the entry's five-byte cushion.
  // 2026-10-31 (`order`, nullable resolvers, `slug`): paired on the same HEAD,
  // CJS +85 / +29 / +23 and ESM +85 / +27 / +26; the cushion stays five bytes.
  // 2026-11-24 (the same loop, through the URL builder the plugin calls): paired Node22.23.2;
  // CJS +23 / +11 / +10 to 2 435 / 1 113 / 999 and ESM +23 / +9 / +7 to 2 427 / 1 103 / 986;
  // the cushion stays five bytes.
  'plugin.cjs': { raw: 2_440, gzip: 1_118, brotli: 1_004 },
  'plugin.js': { raw: 2_432, gzip: 1_108, brotli: 991 },
};
