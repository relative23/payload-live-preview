import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizeHtmlWithPolicy, setSanitizerPolicy } from '@security/sanitizer';

/** The strict policy (ADR 0007, entry 11) against the attack classes it exists for; every case runs compat too. */

afterEach(() => {
  setSanitizerPolicy('strict');
});

describe('strict policy — what changes', () => {
  it('strips id and name, keeps class/aria/role', () => {
    const html = '<p id="hero" name="n" class="c" role="note" aria-label="l">t</p>';
    expect(sanitizeHtml(html, { policy: 'compat' })).toBe(
      '<p id="hero" class="c" role="note" aria-label="l">t</p>',
    );
    expect(sanitizeHtml(html, { policy: 'strict' })).toBe(
      '<p class="c" role="note" aria-label="l">t</p>',
    );
  });

  it('never lets rich text add a binding: data-payload-* is stripped, other data-* only by list', () => {
    const html =
      '<span data-payload-field="price" data-payload-owner="global:x" data-track="cta" data-x="1">v</span>';
    expect(sanitizeHtml(html, { policy: 'compat' })).toBe(html);
    expect(sanitizeHtml(html, { policy: 'strict' })).toBe('<span>v</span>');
    expect(sanitizeHtml(html, { policy: 'strict', allowedDataAttributes: ['data-track'] })).toBe(
      '<span data-track="cta">v</span>',
    );
    expect(
      sanitizeHtml(html, { policy: 'strict', allowedDataAttributes: ['data-payload-field'] }),
    ).toBe('<span>v</span>');
  });

  it('is the module default; setSanitizerPolicy("compat") flips it and per-call options override', () => {
    expect(sanitizeHtml('<p id="a">t</p>')).toBe('<p>t</p>');
    setSanitizerPolicy('compat');
    expect(sanitizeHtml('<p id="a">t</p>')).toBe('<p id="a">t</p>');
    expect(sanitizeHtml('<p id="a">t</p>', { policy: 'strict' })).toBe('<p>t</p>');
  });
});

const POLICIES = ['compat', 'strict'] as const;

describe('DOM clobbering', () => {
  it.each(POLICIES)(
    '[%s] leaves nothing that shadows a form, window or document property',
    (policy) => {
      const out = sanitizeHtml(
        '<form id="location"><input name="submit"><img name="body" src="x"><a id="cookie" href="/">l</a></form>',
        { policy },
      );
      expect(out).not.toContain('<form');
      expect(out).not.toContain('<input');
      expect(out).not.toContain('name=');
      if (policy === 'strict') expect(out).not.toContain('id=');
    },
  );
});

describe('mutation XSS and namespace transitions', () => {
  const vectors = [
    '<svg><p><style><img src=x onerror=alert(1)></style></p></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    '<svg><foreignObject><p>x</p></foreignObject><script>alert(1)</script></svg>',
    '<div><template><script>alert(1)</script></template></div>',
    '<a href="javas cript:alert(1)">x</a><a href="\tjavascript:alert(1)">y</a><a href="JaVaScRiPt:alert(1)">z</a>',
    '<a href="java\tscript:alert(1)">t</a><a href="java\nscript:alert(1)">n</a>',
    '<img srcset="x.png 1x, javascript:alert(1) 2x"><img srcset="data:x, ,,, 2w"><img srcset="a.png 1x b.png">',
  ];
  it.each(POLICIES)('[%s] neutralises each vector and reaches a fixed point', (policy) => {
    for (const vector of vectors) {
      const once = sanitizeHtml(vector, { policy });
      const twice = sanitizeHtml(once, { policy });
      expect(twice, vector).toBe(once);
      expect(once.toLowerCase(), vector).not.toMatch(
        /<script|onerror|java\s*script:|<svg|<math|<style|<template/,
      );
    }
  });
});

describe('policy extension collisions', () => {
  it.each(POLICIES)(
    '[%s] an extension cannot re-admit a dropped tag or an event handler',
    (policy) => {
      const out = sanitizeHtml(
        '<p onclick="x()">t</p><script>x()</script><iframe src="/"></iframe>',
        {
          policy,
          additionalAllowedTags: ['script', 'iframe'],
          additionalAllowedAttributes: { p: ['onclick', 'style'] },
        },
      );
      expect(out).toBe('<p>t</p>');
    },
  );

  it.each(POLICIES)('[%s] an extension cannot make an unsafe URL safe', (policy) => {
    const out = sanitizeHtml('<a href="javascript:x()" ping="/p">l</a>', {
      policy,
      additionalAllowedAttributes: { a: ['href', 'ping'] },
    });
    expect(out).not.toContain('javascript:');
    expect(out).toContain('ping="/p"');
  });
});

describe('sanitizeHtmlWithPolicy — the instance layer between a call and the process default', () => {
  const CLOBBER = '<p id="a">t</p>';
  it.each([
    // [process default, instance policy, per-call policy, expected]
    ['strict', undefined, undefined, '<p>t</p>'],
    ['compat', undefined, undefined, CLOBBER],
    ['strict', 'compat', undefined, CLOBBER],
    ['compat', 'strict', undefined, '<p>t</p>'],
    ['compat', 'strict', 'compat', CLOBBER],
    ['strict', 'compat', 'strict', '<p>t</p>'],
  ] as const)(
    'process %s, instance %s, call %s',
    (processPolicy, instancePolicy, callPolicy, expected) => {
      setSanitizerPolicy(processPolicy);
      const options = callPolicy === undefined ? undefined : { policy: callPolicy };
      expect(sanitizeHtmlWithPolicy(CLOBBER, instancePolicy, options)).toBe(expected);
    },
  );
});
