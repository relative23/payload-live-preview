/**
 * The guides quote sizes: the runtime's transfer size, and the bytes a visitor is charged per delivery path.
 * Both are measurements that move with the code, so each claim is held to the number that decides it: the
 * release gate's budgets for the gzip figures, the delivery budgets' pinned overheads and the runtime
 * artifact for the byte counts. A decision record keeps the numbers of its day and is not read here.
 */

import { INLINE_LEAN_BUDGET } from './bundle-budgets';

/**
 * The runtime's transfer size drifted from 21 KB to 29 KB in the README without
 * anyone noticing, and from 44 KB to 42 and 33 in a guide the check did not read.
 * Every page that names it is held to the release gate's budget within a
 * kilobyte: the default inline script, and the lean artifact where a sentence is
 * about `LEAN_RUNTIME` or says "with the lean artifact".
 */
export function sizeClaimViolations(
  text: string,
  file: string,
  gzipBudget: number,
  leanGzipBudget: number = INLINE_LEAN_BUDGET.gzip,
): string[] {
  const violations: string[] = [];
  const check = (claim: RegExpMatchArray, budget: number, what: string): void => {
    const expected = Math.round(budget / 1024);
    if (Math.abs(Number(claim[1]) - expected) <= 1) return;
    const line = text.slice(0, claim.index).split('\n').length;
    violations.push(
      `${file}:${String(line)} says ${claim[1] ?? ''} KB gzip for ${what}, the budget is ${String(expected)} KB`,
    );
  };
  const lean = [
    ...text.matchAll(/(\d+) K(?:i)?B (?:gzip )?with the lean (?:artifact|inline script)/gu),
    ...text.matchAll(/`LEAN_RUNTIME`[^.]*?about (\d+) KiB gzip/gsu),
  ];
  for (const claim of lean) check(claim, leanGzipBudget, 'the lean artifact');
  for (const claim of text.matchAll(/about (\d+) K(?:i)?B gzip/gu)) {
    // "`LEAN_RUNTIME` ... is about 36 KiB gzip against 44 KiB" is a lean sentence.
    if (/`LEAN_RUNTIME`[^.]*$/su.test(text.slice(Math.max(0, claim.index - 160), claim.index))) {
      continue;
    }
    check(claim, gzipBudget, 'the default inline script');
  }
  return violations;
}

/** What the docs quote in bytes for the delivery paths, and what the code says they are. */
export interface DeliveryFacts {
  /** The runtime artifact, as `runtimeBuildInfo().size` reports it. */
  readonly runtime: number;
  /** `overheadBytes` of the rows in `tests/fixtures/delivery-budgets.ts`. */
  readonly nextBootstrap: number;
  readonly astroLoader: number;
  readonly astroInline: number;
  readonly nextAuthorized: number;
}

export interface DeliveryClaim {
  readonly family: string;
  readonly line: number;
  readonly claimed: number;
  readonly expected: number;
}

const digits = (value: string | undefined): number => Number((value ?? '').replace(/\s/gu, ''));

/**
 * The byte counts the delivery guide, the Next.js guide and the options page
 * quote. Each family is a phrase the docs use today; a family no page matches
 * any more is reported by the caller, so a reworded sentence cannot slip out of
 * the check unnoticed.
 */
export function deliveryFamilies(
  facts: DeliveryFacts,
): readonly (readonly [string, RegExp, number])[] {
  return [
    ['runtime artifact', /the current (\d[\d ]*\d)-byte runtime artifact/gu, facts.runtime],
    [
      'Astro inline row',
      /Astro static build, `mode: 'inline'`\s*\|[^|]*\|\s*(\d[\d ]*\d)\s*\|/gu,
      facts.runtime + facts.astroInline,
    ],
    [
      'authorized Next.js row',
      /`livePreviewScriptProps\(\)` in the root layout\s*\|[^|]*\|\s*(\d[\d ]*\d), twice/gu,
      facts.runtime + facts.nextAuthorized,
    ],
    [
      'authorized Next.js total',
      /against (\d[\d ]*\d) (?:bytes )?for authorized inline delivery/gu,
      facts.runtime + facts.nextAuthorized,
    ],
    // The bootstrap carries the options, so its size is the example's: the guide names that.
    [
      'Next.js bootstrap on the example',
      /(\d[\d ]*\d) bytes on the\s+example/gu,
      facts.nextBootstrap,
    ],
    [
      'Next.js bootstrap in the guide',
      /Next\.js fixture's delivery is a (\d[\d ]*\d)-byte/gu,
      facts.nextBootstrap,
    ],
    [
      'Next.js bootstrap in the options',
      /is (\d[\d ]*\d) bytes\s+in its direct script element/gu,
      facts.nextBootstrap,
    ],
    [
      'Next.js bootstrap row',
      /Next\.js, `delivery: 'asset'`\s*\|[^|]*\|\s*(\d[\d ]*\d), twice/gu,
      facts.nextBootstrap,
    ],
    [
      'Astro loader row',
      /Astro static build, `mode: 'loader'`\s*\|[^|]*\|\s*(\d+)\s*\|/gu,
      facts.astroLoader,
    ],
    ['Astro loader floor', /(\d+) bytes is the floor of this table/gu, facts.astroLoader],
  ];
}

export function deliveryClaims(text: string, facts: DeliveryFacts): DeliveryClaim[] {
  const claims: DeliveryClaim[] = [];
  for (const [family, pattern, expected] of deliveryFamilies(facts)) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      claims.push({ family, line, claimed: digits(match[1]), expected });
    }
  }
  return claims;
}

export function deliveryClaimViolations(claims: readonly DeliveryClaim[], file: string): string[] {
  return claims
    .filter((claim) => claim.claimed !== claim.expected)
    .map(
      (claim) =>
        `${file}:${String(claim.line)} says ${String(claim.claimed)} bytes for the ${claim.family}, the code says ${String(claim.expected)}`,
    );
}

/** `overheadBytes` of the row called `name` in the delivery budgets' source. */
export function deliveryOverhead(source: string, name: string): number {
  const at = source.indexOf(`name: '${name}'`);
  const found = at === -1 ? null : /overheadBytes: ([\d_]+)/u.exec(source.slice(at));
  if (found === null) throw new Error(`delivery-budgets.ts has no overheadBytes for "${name}"`);
  return Number(found[1]?.replaceAll('_', ''));
}
