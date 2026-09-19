import { describe, expect, it } from 'vitest';
import createDOMPurify from 'dompurify';
import { sanitizeHtml, type SanitizeOptions } from '@security/sanitizer';
import { templateSanitizeOptions } from '@core/template-sanitize';
import { CORPUS, REGRESSIONS, type Vector } from './xss-corpus';
import {
  assertNoActiveContent,
  missingFromPurify,
  purifyLikeOurs,
  type CorpusPolicy,
} from './sanitizer-oracle';

/**
 * The XSS corpus, run under every policy the package ships: the rich-text
 * default (`strict`), the 1.x `compat` policy, and the author-template
 * options the structural applier uses. Three questions per vector:
 *
 * 1. Does anything script-capable survive? The oracle in
 *    `sanitizer-oracle.ts` is a deny-list of constructs a browser would run
 *    or navigate on, independent of the sanitizer's own allow-lists.
 * 2. Is the output a fixed point? Mutation XSS lives in the gap between a
 *    serialisation and its re-parse; a second pass that changes anything is
 *    that gap.
 * 3. Do we keep anything DOMPurify drops? DOMPurify is the reference engine
 *    (a devDependency, never shipped); for `strict` and templates every
 *    (tag, attribute) pair we keep must be one it keeps too, bar the pairs
 *    we add on purpose (`rel` and `target` on external links) and the
 *    author's own custom elements, which DOMPurify refuses by default.
 *
 * `compat` is exempt from the third question and says why: it keeps `id`
 * and `name`, which DOMPurify's clobbering guard would drop; that is the
 * documented cost of the 1.x policy (docs/security.md §5c) and one reason
 * it sunsets in 3.0.
 */

const purify = createDOMPurify(window);

const POLICIES: readonly CorpusPolicy[] = [
  { name: 'strict', options: { policy: 'strict' } },
  { name: 'compat', options: { policy: 'compat' } },
  { name: 'template', options: undefined },
];

/** `compat` is exempt from the reference comparison; the header says why. */
const DIFFERENTIAL_POLICIES: readonly CorpusPolicy[] = [
  { name: 'strict', options: { policy: 'strict' } },
  { name: 'template', options: undefined },
];

function optionsFor(policy: CorpusPolicy, input: string): SanitizeOptions {
  return policy.name === 'template'
    ? { ...templateSanitizeOptions(input), policy: 'strict' }
    : policy.options!;
}

function every(callback: (vector: Vector, className: string) => void): void {
  for (const group of CORPUS) for (const vector of group.vectors) callback(vector, group.name);
  for (const vector of REGRESSIONS) callback(vector, 'regressions');
}

describe('the corpus itself', () => {
  it('has unique ids, and a regression never repeats a corpus id', () => {
    const seen = new Set<string>();
    every((vector) => {
      expect(seen.has(vector.id), `duplicate vector id ${vector.id}`).toBe(false);
      seen.add(vector.id);
    });
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe.each(POLICIES)('under the $name policy', (policy) => {
  it('leaves nothing script-capable in any vector', () => {
    every((vector) => {
      const output = sanitizeHtml(vector.input, optionsFor(policy, vector.input));
      assertNoActiveContent(output, policy, vector.id);
    });
  });

  it('is a fixed point on every vector: a second pass changes nothing', () => {
    every((vector) => {
      const options = optionsFor(policy, vector.input);
      const once = sanitizeHtml(vector.input, options);
      expect(sanitizeHtml(once, options), vector.id).toBe(once);
    });
  });
});

describe.each(DIFFERENTIAL_POLICIES)('under the $name policy, against DOMPurify', (policy) => {
  it('keeps nothing DOMPurify would drop, bar the differences ADR 0016 classifies', () => {
    const findings: string[] = [];
    every((vector) => {
      const options = optionsFor(policy, vector.input);
      const ours = sanitizeHtml(vector.input, options);
      const theirs = purifyLikeOurs(purify, vector.input);
      const missing = missingFromPurify(ours, theirs, options, vector.input);
      if (missing.length > 0) findings.push(`${vector.id}: ${missing.join(', ')}`);
    });
    expect(findings).toEqual([]);
  });
});

describe('what compat keeps that strict does not', () => {
  it('keeps id on the clobbering vectors, which strict strips and DOMPurify guards; name is per-tag in both', () => {
    const clobbering = CORPUS.find((group) => group.name === 'dom clobbering')!.vectors;
    for (const vector of clobbering) {
      const compat = sanitizeHtml(vector.input, { policy: 'compat' });
      const strict = sanitizeHtml(vector.input, { policy: 'strict' });
      expect(strict, vector.id).not.toMatch(/\s(?:id|name)=/u);
      expect(compat, vector.id).not.toMatch(/\sname=/u);
      // Compat keeps `id` wherever the element itself survives.
      if (/<(?:img|a|p)\b/u.test(compat) && /\sid="/u.test(vector.input)) {
        expect(compat, vector.id).toMatch(/\sid=/u);
      }
    }
  });
});
