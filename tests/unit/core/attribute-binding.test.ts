/**
 * Policed attribute writes for `data-payload-attribute` bindings.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyAttributeBinding } from '@core/attribute-binding';

function el(tag = 'div'): Element {
  return document.createElement(tag);
}

describe('applyAttributeBinding', () => {
  it('writes plain content attributes', () => {
    const target = el('time');
    expect(applyAttributeBinding(target, 'datetime', '2026-07-11')).toBe('applied');
    expect(target.getAttribute('datetime')).toBe('2026-07-11');
  });

  it('stringifies numbers and booleans', () => {
    const target = el();
    applyAttributeBinding(target, 'data-count', 42);
    expect(target.getAttribute('data-count')).toBe('42');
  });

  it('removes the attribute for null/undefined values', () => {
    const target = el();
    target.setAttribute('title', 'x');
    expect(applyAttributeBinding(target, 'title', null)).toBe('applied');
    expect(target.hasAttribute('title')).toBe(false);
  });

  it('blocks event-handler attributes', () => {
    const target = el();
    expect(applyAttributeBinding(target, 'onclick', 'alert(1)')).toBe('blocked');
    expect(applyAttributeBinding(target, 'ONError', 'alert(1)')).toBe('blocked');
    expect(target.attributes.length).toBe(0);
  });

  it('blocks style, srcdoc, formaction, form, id, name, is, srcset', () => {
    const target = el();
    for (const attr of ['style', 'srcdoc', 'formaction', 'form', 'id', 'name', 'is', 'srcset']) {
      expect(applyAttributeBinding(target, attr, 'x')).toBe('blocked');
    }
    expect(target.attributes.length).toBe(0);
  });

  it('validates URLs for href/src/poster', () => {
    const img = el('img');
    expect(applyAttributeBinding(img, 'src', 'javascript:alert(1)')).toBe('blocked');
    expect(img.hasAttribute('src')).toBe(false);
    expect(applyAttributeBinding(img, 'src', 'https://example.com/x.jpg')).toBe('applied');
    expect(img.getAttribute('src')).toBe('https://example.com/x.jpg');

    const a = el('a');
    expect(applyAttributeBinding(a, 'href', ' \tjavascript:alert(1)')).toBe('blocked');
    expect(applyAttributeBinding(a, 'href', '/relative/path')).toBe('applied');
  });

  it.each(['href', 'src', 'poster', 'cite', 'action', 'xlink:href', 'data'])(
    'gates %s by isSafeUrl: a javascript: URL is blocked, a path is written',
    (attribute) => {
      const target = el('object');
      expect(applyAttributeBinding(target, attribute, 'javascript:alert(1)')).toBe('blocked');
      expect(target.hasAttribute(attribute)).toBe(false);
      expect(applyAttributeBinding(target, attribute, '/media/x')).toBe('applied');
      expect(target.getAttribute(attribute)).toBe('/media/x');
    },
  );

  it('blocks imagesrcset like srcset: a multi-URL attribute has no single URL to check', () => {
    const target = el('link');
    expect(applyAttributeBinding(target, 'imagesrcset', '/a.jpg 1x')).toBe('blocked');
    expect(target.attributes.length).toBe(0);
  });

  it('removes the attribute for undefined exactly as for null', () => {
    const target = el();
    target.setAttribute('title', 'x');
    expect(applyAttributeBinding(target, 'title', undefined)).toBe('applied');
    expect(target.hasAttribute('title')).toBe(false);
  });

  it('writes a boolean as its string, both values', () => {
    const target = el();
    expect(applyAttributeBinding(target, 'data-open', true)).toBe('applied');
    expect(target.getAttribute('data-open')).toBe('true');
    expect(applyAttributeBinding(target, 'data-open', false)).toBe('applied');
    expect(target.getAttribute('data-open')).toBe('false');
  });

  it('blocks non-scalar values', () => {
    const target = el();
    expect(applyAttributeBinding(target, 'title', { toString: () => 'x' })).toBe('blocked');
    expect(applyAttributeBinding(target, 'title', ['a'])).toBe('blocked');
  });

  it('blocks empty attribute names', () => {
    expect(applyAttributeBinding(el(), '', 'x')).toBe('blocked');
    expect(applyAttributeBinding(el(), '   ', 'x')).toBe('blocked');
  });
});
