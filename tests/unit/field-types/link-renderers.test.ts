import { describe, expect, it, vi } from 'vitest';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

describe('url renderer', () => {
  it('sets text and href on anchors', () => {
    const el = document.createElement('a');
    rendererNamed('url').render(makeTarget(el), 'https://example.com', emptyContext());
    expect(el.textContent).toBe('https://example.com');
    expect(el.href).toBe('https://example.com/');
  });

  it('pulls href from sibling field when hrefField is set', () => {
    const el = document.createElement('a');
    rendererNamed('url').render(
      makeTarget(el, { hrefField: 'linkTo' }),
      'Visit',
      emptyContext({ linkTo: 'https://example.com' }),
    );
    expect(el.textContent).toBe('Visit');
    expect(el.href).toBe('https://example.com/');
  });

  it('resolves a dotted sibling href path without traversing prototypes', () => {
    const el = document.createElement('a');
    rendererNamed('url').render(
      makeTarget(el, { hrefField: 'cta.destination' }),
      'Visit',
      emptyContext({ cta: { destination: 'https://example.com/nested' } }),
    );
    expect(el.href).toBe('https://example.com/nested');
  });

  it('writes plain text on non-anchors and the value on inputs', () => {
    const p = document.createElement('p');
    rendererNamed('url').render(makeTarget(p), 'https://example.com', emptyContext());
    expect(p.textContent).toBe('https://example.com');

    const input = document.createElement('input');
    rendererNamed('url').render(makeTarget(input), 'https://example.com', emptyContext());
    expect(input.value).toBe('https://example.com');
  });

  it('treats an empty sibling href path as absent', () => {
    const el = document.createElement('a');
    rendererNamed('url').render(
      makeTarget(el, { hrefField: '' }),
      'https://example.com',
      emptyContext(),
    );
    expect(el.href).toBe('https://example.com/');
  });

  it('clears href and warns once for an unsafe sibling URL, still writing the text', () => {
    const el = document.createElement('a');
    el.href = 'https://before.example.com/';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = rendererNamed('url');
    const target = makeTarget(el, { hrefField: 'linkTo' });

    url.render(target, 'Visit', emptyContext({ linkTo: 'javascript:alert(1)' }));
    url.render(target, 'Visit', emptyContext({ linkTo: 'javascript:alert(2)' }));

    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('Visit');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('LP0401');
    warn.mockRestore();
  });

  it('leaves href alone when the sibling field is absent', () => {
    const el = document.createElement('a');
    el.href = 'https://before.example.com/';
    rendererNamed('url').render(makeTarget(el, { hrefField: 'linkTo' }), 'Visit', emptyContext());
    expect(el.getAttribute('href')).toBe('https://before.example.com/');
  });
});

describe('email renderer', () => {
  it('links a bare address with mailto:', () => {
    const el = document.createElement('a');
    rendererNamed('email').render(makeTarget(el), 'jane@example.com', emptyContext());
    expect(el.getAttribute('href')).toBe('mailto:jane@example.com');
    expect(el.textContent).toBe('jane@example.com');
  });

  it('keeps a value that already carries a scheme', () => {
    const el = document.createElement('a');
    rendererNamed('email').render(
      makeTarget(el),
      'mailto:jane@example.com?subject=hi',
      emptyContext(),
    );
    expect(el.getAttribute('href')).toBe('mailto:jane@example.com?subject=hi');
  });

  it('writes plain text outside anchors', () => {
    const el = document.createElement('span');
    rendererNamed('email').render(makeTarget(el), 'jane@example.com', emptyContext());
    expect(el.textContent).toBe('jane@example.com');
  });

  it('is registered under its own name', () => {
    expect(rendererNamed('email').name).toBe('email');
  });
});

describe('relationship renderer', () => {
  it('picks the first available label', () => {
    const el = document.createElement('span');
    rendererNamed('relationship').render(makeTarget(el), { title: 'Hello' }, emptyContext());
    expect(el.textContent).toBe('Hello');
  });

  it('falls through title, name, slug, id', () => {
    const el = document.createElement('span');
    const relationship = rendererNamed('relationship');
    relationship.render(makeTarget(el), { name: 'n', slug: 's', id: 7 }, emptyContext());
    expect(el.textContent).toBe('n');
    relationship.render(makeTarget(el), { slug: 's', id: 7 }, emptyContext());
    expect(el.textContent).toBe('s');
    relationship.render(makeTarget(el), { id: 7 }, emptyContext());
    expect(el.textContent).toBe('7');
  });

  it('joins has-many relationships', () => {
    const el = document.createElement('span');
    rendererNamed('relationship').render(
      makeTarget(el),
      [{ title: 'A' }, { title: 'B' }],
      emptyContext(),
    );
    expect(el.textContent).toBe('A, B');
  });

  it('sets href on an anchor', () => {
    const el = document.createElement('a');
    rendererNamed('relationship').render(
      makeTarget(el),
      { title: 'x', url: '/posts/x' },
      emptyContext(),
    );
    expect(el.getAttribute('href')).toBe('/posts/x');
    expect(el.textContent).toBe('x');
  });

  it('keeps the existing href when the relation carries none', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/server-route');
    rendererNamed('relationship').render(makeTarget(el), { title: 'x' }, emptyContext());
    expect(el.getAttribute('href')).toBe('/server-route');
  });

  it('shows a bare id as text', () => {
    const el = document.createElement('span');
    rendererNamed('relationship').render(makeTarget(el), 'abc123', emptyContext());
    expect(el.textContent).toBe('abc123');
  });
});
