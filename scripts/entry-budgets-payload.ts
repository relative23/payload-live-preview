/**
 * Byte budgets for the Payload configuration entries.
 * They stay separate because the main historical ledger is at its line limit.
 */
import type { BundleBudget } from './bundle-measure';

export const PAYLOAD_ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
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
  // 2026-11-25 (3.0, Payload 2 leaves and its admin is refused with LP0504, ADR 0007 row 25): paired Node24.22.3/npm12.0.2; -140/-44/-35 B; prior reserves kept.
  // 2026-11-27 (3.0, ADR 0007 rows 41 and 42: the payload entry merges into plugin): paired Node24.22.3/npm12.0.2; +43/+12/+6 B; prior reserves kept.
  'plugin.cjs': { raw: 2_343, gzip: 1_086, brotli: 975 },
  // 2026-11-25 (3.0, Payload 2 leaves and its admin is refused with LP0504, ADR 0007 row 25): paired Node24.22.3/npm12.0.2; -140/-43/-32 B; prior reserves kept.
  // 2026-11-27 (3.0, ADR 0007 rows 41 and 42: the payload entry merges into plugin): paired Node24.22.3/npm12.0.2; +38/+16/+13 B; prior reserves kept.
  'plugin.js': { raw: 2_330, gzip: 1_081, brotli: 972 },
};
