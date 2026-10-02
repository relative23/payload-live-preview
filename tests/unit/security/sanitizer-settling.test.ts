import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sanitizeHtml,
  type SanitizeOptions,
  type SanitizerDocument,
  type SanitizerPolicyMode,
} from '@security/sanitizer';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * The sanitizer's output is a fixed point by construction (PHD-19): it
 * sanitises, serialises, parses what it wrote and sanitises that, until a pass
 * changes nothing. Unwrapping an unknown tag can leave a tree no parser
 * produces (an `a` inside an `a`, a `li` inside a `li`); the consumer's
 * `innerHTML` rebuilds it as the parser would, so the string handed back must
 * already be the rebuilt one.
 */

const POLICIES: readonly (readonly [SanitizerPolicyMode, SanitizeOptions])[] = [
  ['strict', { policy: 'strict' }],
  ['compat', { policy: 'compat' }],
];

const NESTED: readonly (readonly [string, string, string])[] = [
  [
    'an anchor inside an anchor',
    "<p><a><summary href=''><script>alert(1)</script>'><table><a>",
    "<p><a></a></p><a>'&gt;</a><a></a><table></table>",
  ],
  [
    'a list item inside a list item',
    '<p><li><table><li>',
    '<p></p><li></li><li></li><table></table>',
  ],
  ['the same through an unwrapped summary', '<p><li><summary><li>', '<p></p><li></li><li></li>'],
];

/** A document that counts the parses the sanitizer asks of it. */
function countingDocument(): { document: SanitizerDocument; parses: () => number } {
  let parses = 0;
  return {
    document: {
      createElement: (tagName) => {
        parses += 1;
        return document.createElement(tagName) as HTMLTemplateElement;
      },
    },
    parses: () => parses,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetDevWarnings();
});

describe('sanitizeHtml settles on a fixed point', () => {
  describe.each(POLICIES)('under the %s policy', (_name, options) => {
    it.each(NESTED)('hands back the re-parsed form of %s', (_label, input, expected) => {
      const once = sanitizeHtml(input, options);
      expect(once).toBe(expected);
      expect(sanitizeHtml(once, options)).toBe(once);
    });
  });

  it('parses clean, canonical markup once: the first pass already changed nothing', () => {
    const counting = countingDocument();
    expect(sanitizeHtml('<p>x</p>', { document: counting.document })).toBe('<p>x</p>');
    expect(counting.parses()).toBe(1);
  });

  it('parses markup the first pass rewrote twice: the second pass finds nothing to change', () => {
    const counting = countingDocument();
    expect(sanitizeHtml('<P onclick="x">y</P>', { document: counting.document })).toBe('<p>y</p>');
    expect(counting.parses()).toBe(2);
  });

  it('parses a tree no parser produces three times: the form it settles on is the third', () => {
    const counting = countingDocument();
    sanitizeHtml('<p><li><table><li>', { document: counting.document });
    expect(counting.parses()).toBe(3);
  });
});

describe('sanitizeHtml when the output never settles', () => {
  /** Every parse reads back different markup, as a parser that disagrees with itself would. */
  function unsettled(): { document: SanitizerDocument; parses: () => number } {
    let parses = 0;
    return {
      document: {
        createElement: () => ({
          set innerHTML(_value: string) {},
          get innerHTML(): string {
            parses += 1;
            return `<p>${String(parses)}</p>`;
          },
          content: { childNodes: [] } as unknown as ParentNode,
        }),
      },
      parses: () => parses,
    };
  }

  it('returns nothing rather than markup it could not settle, after six parses', () => {
    const never = unsettled();
    expect(sanitizeHtml('<p>x</p>', { document: never.document })).toBe('');
    expect(never.parses()).toBe(6);
  });

  it('says so once, in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sanitizeHtml('<p>x</p>', { document: unsettled().document });
    sanitizeHtml('<p>y</p>', { document: unsettled().document });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('did not settle after 6 passes');
    // The key keeps this warning apart from the others once per process.
    const issued = (globalThis as Record<string, unknown>)[
      '__payloadLivePreviewDeprecationsWarned'
    ];
    expect([...(issued as Set<string>)]).toEqual(['sanitizer-unsettled']);
  });
});
