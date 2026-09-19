import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '@security/sanitizer';

/** Global, ARIA and `data-*` attributes under the strict default and the compat profile. */

describe('sanitizeHtml — global and ARIA attributes', () => {
  it('keeps the global attributes other than id under the default policy', () => {
    const html =
      '<span class="c" lang="de" dir="ltr" title="t" role="status" tabindex="0">y</span>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps id only under compat', () => {
    const html = '<span id="x" class="c">y</span>';
    expect(sanitizeHtml(html)).toBe('<span class="c">y</span>');
    expect(sanitizeHtml(html, { policy: 'compat' })).toBe(html);
  });

  it('keeps aria-* attributes under both policies', () => {
    expect(sanitizeHtml('<div aria-label="x">y</div>')).toContain('aria-label="x"');
    expect(sanitizeHtml('<div aria-label="x">y</div>', { policy: 'compat' })).toContain(
      'aria-label="x"',
    );
  });
});

const CASES = [
  {
    name: 'a data-* attribute not on the list',
    html: '<span data-test="x">z</span>',
    options: {},
    strict: '<span>z</span>',
    compat: '<span data-test="x">z</span>',
  },
  {
    name: 'a data-* attribute on allowedDataAttributes',
    html: '<span data-test="x">z</span>',
    options: { allowedDataAttributes: ['data-test'] },
    strict: '<span data-test="x">z</span>',
    compat: '<span data-test="x">z</span>',
  },
  {
    name: 'id listed in additionalAllowedAttributes',
    html: '<p id="a">t</p>',
    options: { additionalAllowedAttributes: { p: ['id'] } },
    strict: '<p>t</p>',
    compat: '<p id="a">t</p>',
  },
  {
    name: 'name listed in additionalAllowedAttributes',
    html: '<p name="n">t</p>',
    options: { additionalAllowedAttributes: { p: ['name'] } },
    strict: '<p>t</p>',
    compat: '<p name="n">t</p>',
  },
  {
    name: 'data-payload-* listed in both allow-lists',
    html: '<span data-payload-field="f">v</span>',
    options: {
      allowedDataAttributes: ['data-payload-field'],
      additionalAllowedAttributes: { span: ['data-payload-field'] },
    },
    strict: '<span>v</span>',
    compat: '<span data-payload-field="f">v</span>',
  },
] as const;

describe.each(CASES)('strict versus compat: $name', ({ html, options, strict, compat }) => {
  it('strict strips what an extension may not re-admit', () => {
    expect(sanitizeHtml(html, { ...options, policy: 'strict' })).toBe(strict);
  });

  it('compat keeps it', () => {
    expect(sanitizeHtml(html, { ...options, policy: 'compat' })).toBe(compat);
  });

  it('the module default is strict', () => {
    expect(sanitizeHtml(html, options)).toBe(strict);
  });
});

describe('sanitizeHtml — templateMode (page-author item templates)', () => {
  const template =
    '<li id="row" name="row" data-payload-key="k" data-payload-nested-key="n" ' +
    'data-payload-nested-template="t" data-payload-field="title" data-track="x">v</li>';

  it('keeps exactly the reconciliation attributes under strict and still strips bindings', () => {
    expect(sanitizeHtml(template, { templateMode: true })).toBe(
      '<li id="row" name="row" data-payload-key="k" data-payload-nested-key="n" ' +
        'data-payload-nested-template="t">v</li>',
    );
  });

  it('changes nothing without it', () => {
    expect(sanitizeHtml(template)).toBe('<li>v</li>');
  });

  it('changes nothing under compat', () => {
    const compat = sanitizeHtml(template, { policy: 'compat' });
    expect(sanitizeHtml(template, { policy: 'compat', templateMode: true })).toBe(compat);
    expect(compat).toContain('data-payload-field="title"');
  });

  it('still strips handlers, style and unsafe URLs', () => {
    const out = sanitizeHtml(
      '<a id="l" href="javascript:x()" onclick="y()" style="color:red">l</a>',
      { templateMode: true },
    );
    expect(out).toBe('<a id="l">l</a>');
  });

  it('empties `is` instead of removing it: the value is immutable and would be re-serialised', () => {
    // Removing the attribute leaves the element's `is` value, which the
    // serialiser writes back; a re-parse would then upgrade the element to
    // the page's customised built-in of that name (found by the XSS corpus).
    for (const policy of ['strict', 'compat'] as const) {
      expect(sanitizeHtml('<p is="x-evil">x</p>', { policy })).toBe('<p is="">x</p>');
      expect(sanitizeHtml('<p is="">x</p>', { policy })).toBe('<p is="">x</p>');
    }
    expect(sanitizeHtml('<p title="t">x</p>')).toBe('<p title="t">x</p>');
  });
});
