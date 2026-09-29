import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lexicalToHtml, __resetSanitizerWarningForTests } from '@lexical/render';
import { layoutClassAttribute, resolveAlignment, resolveIndent } from '@lexical/utils';
import { SanitizerEnvironmentError, setSanitizerPolicy } from '@security/sanitizer';
import { makeRoot } from './helpers';

beforeEach(() => {
  setSanitizerPolicy('strict');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('alignment and indent', () => {
  it.each([
    ['center', 'lp-align-center'],
    ['right', 'lp-align-right'],
    ['justify', 'lp-align-justify'],
    ['start', 'lp-align-start'],
    ['end', 'lp-align-end'],
    [2, 'lp-align-center'],
    [3, 'lp-align-right'],
  ])('renders format %s as class %s and keeps it under strict sanitisation', (format, klass) => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'paragraph', format, children: [{ type: 'text', text: 'x' }] }]),
    );
    expect(html).toBe(`<p class="${klass}">x</p>`);
  });

  it('renders indent as a class, combined with alignment', () => {
    const html = lexicalToHtml(
      makeRoot([
        { type: 'paragraph', format: 'center', indent: 2, children: [{ type: 'text', text: 'x' }] },
      ]),
    );
    expect(html).toBe('<p class="lp-align-center lp-indent-2">x</p>');
  });

  it('applies the classes to headings, quotes, lists and list items', () => {
    const html = lexicalToHtml(
      makeRoot([
        { type: 'heading', tag: 'h3', format: 'right', children: [{ type: 'text', text: 'h' }] },
        { type: 'quote', indent: 1, children: [{ type: 'text', text: 'q' }] },
        {
          type: 'list',
          listType: 'bullet',
          format: 'center',
          children: [{ type: 'listitem', indent: 1, children: [{ type: 'text', text: 'i' }] }],
        },
      ]),
    );
    expect(html).toBe(
      '<h3 class="lp-align-right">h</h3>' +
        '<blockquote class="lp-indent-1">q</blockquote>' +
        '<ul class="lp-align-center"><li class="lp-indent-1">i</li></ul>',
    );
  });

  it('never emits a style attribute', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'paragraph', format: 'center', indent: 3, children: [] }]),
      { sanitize: false },
    );
    expect(html).not.toContain('style=');
  });

  it('keeps the public resolvers and ignores unknown formats', () => {
    expect(resolveAlignment({ type: 'paragraph', format: 'center' })).toBe('center');
    expect(resolveAlignment({ type: 'paragraph', format: 4 })).toBe('justify');
    expect(resolveAlignment({ type: 'paragraph', format: 'diagonal' })).toBeUndefined();
    expect(resolveAlignment({ type: 'paragraph', format: 9 })).toBeUndefined();
    expect(resolveIndent({ type: 'paragraph', indent: -1 })).toBe(0);
    expect(layoutClassAttribute({ type: 'paragraph' })).toBe('');
  });
});

describe('server rendering without a sanitizer document', () => {
  it('returns the rendered HTML and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('document', undefined);
    __resetSanitizerWarningForTests();
    const doc = makeRoot([{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }]);

    expect(lexicalToHtml(doc)).toBe('<p>x</p>');
    expect(lexicalToHtml(doc)).toBe('<p>x</p>');

    expect(warn).toHaveBeenCalledOnce();
    // ADR 0025: the warning names the per-call document, the opt-in and 3.0,
    // not the process-wide setter 2.1 deprecated.
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('{ document }');
    expect(message).toContain('requireDocument: true');
    expect(message).toContain('3.0');
    expect(message).not.toContain('setSanitizerDocument');
  });

  it('refuses to return unsanitised HTML under requireDocument, as sanitizeHtml does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('document', undefined);
    __resetSanitizerWarningForTests();
    const doc = makeRoot([{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }]);

    expect(() => lexicalToHtml(doc, { requireDocument: true })).toThrow(SanitizerEnvironmentError);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets an explicit sanitize: false win over requireDocument', () => {
    vi.stubGlobal('document', undefined);
    const doc = makeRoot([{ type: 'paragraph', children: [{ type: 'text', text: 'x' }] }]);

    expect(lexicalToHtml(doc, { requireDocument: true, sanitize: false })).toBe('<p>x</p>');
  });

  it('stays silent when the caller opted out of sanitising', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('document', undefined);
    __resetSanitizerWarningForTests();

    lexicalToHtml(makeRoot([{ type: 'paragraph', children: [] }]), { sanitize: false });

    expect(warn).not.toHaveBeenCalled();
  });
});
