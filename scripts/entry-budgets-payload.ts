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
  'payload.cjs': { raw: 1_269, gzip: 648, brotli: 569 },
  'payload.js': { raw: 1_261, gzip: 641, brotli: 560 },
  // 2026-09-23 (`./plugin`): new Payload config entry, measured at
  // 2 263 / 1 043 / 944 CJS and 2 255 / 1 038 / 929 ESM. Like `./payload`,
  // each dimension carries five bytes rather than a percentage-sized step.
  // 2026-09-24 (last-value preview intent): CJS measured 2 282 / 1 053 / 955
  // and ESM 2 274 / 1 049 / 942; the same 5 B cushion is retained.
  // 2026-09-24 (Payload 3's non-localized callback and encoded custom query
  // key): CJS measured 2 327 / 1 073 / 966 and ESM 2 319 / 1 067 / 953;
  // each dimension retains the entry's five-byte cushion.
  'plugin.cjs': { raw: 2_332, gzip: 1_078, brotli: 971 },
  'plugin.js': { raw: 2_324, gzip: 1_072, brotli: 958 },
};
