import { describe, expect, it, vi } from 'vitest';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

describe('image renderer', () => {
  it('sets src and alt from a media object', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg', alt: 'caption' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/a.jpg');
    expect(el.alt).toBe('caption');
  });

  it('pulls alt from sibling field when not on media object', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { altField: 'caption' }),
      { url: 'https://cdn.example.com/a.jpg' },
      emptyContext({ caption: 'fallback' }),
    );
    expect(el.alt).toBe('fallback');
  });

  it('lets an explicit sibling alt override a media-object alt', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { altField: 'caption' }),
      { url: 'https://cdn.example.com/a.jpg', alt: 'media alt' },
      emptyContext({ caption: 'explicit alt' }),
    );
    expect(el.alt).toBe('explicit alt');
  });

  it('uses the element locale for an explicit sibling alt override', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { altField: 'caption', locale: 'de' }),
      { url: 'https://cdn.example.com/a.jpg', alt: 'media alt' },
      { ...emptyContext({ caption: 'English', caption_de: 'Deutsch' }), locale: 'de' },
    );
    expect(el.alt).toBe('Deutsch');
  });

  it('resolves dotted sibling alt paths', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { altField: 'hero.alt' }),
      { url: 'https://cdn.example.com/a.jpg' },
      emptyContext({ hero: { alt: 'nested fallback' } }),
    );
    expect(el.alt).toBe('nested fallback');
  });

  it('pulls src from the configured sibling field', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { srcField: 'hero.assetUrl' }),
      'descriptive label',
      emptyContext({ hero: { assetUrl: 'https://cdn.example.com/from-sibling.jpg' } }),
    );
    expect(el.src).toBe('https://cdn.example.com/from-sibling.jpg');
  });

  it('clears src and warns once for an unsafe sibling src', () => {
    const el = document.createElement('img');
    el.src = 'https://cdn.example.com/before.jpg';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rendererNamed('image').render(
      makeTarget(el, { srcField: 'assetUrl' }),
      'https://cdn.example.com/fallback.jpg',
      emptyContext({ assetUrl: 'javascript:alert(1)' }),
    );
    expect(el.hasAttribute('src')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('sets background-image on non-img elements', () => {
    const el = document.createElement('div');
    rendererNamed('image').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg' },
      emptyContext(),
    );
    expect(el.style.backgroundImage).toMatch(
      /url\(["']?https:\/\/cdn\.example\.com\/a\.jpg["']?\)/,
    );
  });

  it('refuses unsafe urls', () => {
    const el = document.createElement('img');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rendererNamed('image').render(makeTarget(el), { url: 'javascript:alert(1)' }, emptyContext());
    expect(el.getAttribute('src')).toBeNull();
    warn.mockRestore();
  });

  it('accepts plain string urls', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(makeTarget(el), 'https://cdn.example.com/x.jpg', emptyContext());
    expect(el.src).toBe('https://cdn.example.com/x.jpg');
  });

  it('treats empty sibling src and alt paths as absent', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el, { srcField: '', altField: '' }),
      { url: 'https://cdn.example.com/x.jpg', alt: 'media alt' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/x.jpg');
    expect(el.alt).toBe('media alt');
  });
});

describe('image renderer — responsive sources', () => {
  const media = {
    url: 'https://cdn.example.com/full.jpg',
    width: 1600,
    sizes: {
      thumb: { url: 'https://cdn.example.com/thumb.jpg', width: 400 },
      card: { url: 'https://cdn.example.com/card.jpg', width: 800 },
      broken: { url: 'javascript:alert(1)', width: 1200 },
      noWidth: { url: 'https://cdn.example.com/nowidth.jpg' },
    },
  };

  it('rebuilds srcset from media.sizes, dropping unsafe and width-less candidates', () => {
    const el = document.createElement('img');
    el.setAttribute('srcset', 'https://cdn.example.com/old-400.jpg 400w');
    el.setAttribute('sizes', '(max-width: 600px) 100vw, 50vw');
    rendererNamed('image').render(makeTarget(el), media, emptyContext());
    expect(el.getAttribute('srcset')).toBe(
      'https://cdn.example.com/thumb.jpg 400w, https://cdn.example.com/card.jpg 800w, https://cdn.example.com/full.jpg 1600w',
    );
    expect(el.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, 50vw');
  });

  it('removes a server-rendered srcset and sizes when the media has no sizes', () => {
    const el = document.createElement('img');
    el.setAttribute('srcset', 'https://cdn.example.com/old-400.jpg 400w');
    el.setAttribute('sizes', '100vw');
    rendererNamed('image').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/plain.jpg' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/plain.jpg');
    expect(el.hasAttribute('srcset')).toBe(false);
    expect(el.hasAttribute('sizes')).toBe(false);
  });

  it('escapes commas and spaces inside a candidate URL', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el),
      { url: '/media/a.jpg', sizes: { s: { url: '/media/odd, name.jpg', width: 100 } } },
      emptyContext(),
    );
    expect(el.getAttribute('srcset')).toBe('/media/odd%2C%20name.jpg 100w');
  });

  it('applies the same srcset handling through the upload renderer', () => {
    const el = document.createElement('img');
    rendererNamed('upload').render(makeTarget(el), media, emptyContext());
    expect(el.getAttribute('srcset')).toContain('thumb.jpg 400w');
  });
});

describe('upload renderer', () => {
  it('sets src on <img>', () => {
    const el = document.createElement('img');
    rendererNamed('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg', alt: 'x' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/a.jpg');
    expect(el.alt).toBe('x');
  });

  it('sets href + text on <a>', () => {
    const el = document.createElement('a');
    rendererNamed('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.pdf', filename: 'a.pdf' },
      emptyContext(),
    );
    expect(el.href).toBe('https://cdn.example.com/a.pdf');
    expect(el.textContent).toBe('a.pdf');
  });

  it('renders a fallback anchor in other elements', () => {
    const el = document.createElement('div');
    rendererNamed('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.pdf', filename: 'a.pdf' },
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<a href="https://cdn.example.com/a.pdf"');
  });

  it('does not write for a bare id', () => {
    const el = document.createElement('img');
    el.src = 'https://cdn.example.com/before.jpg';
    expect(rendererNamed('upload').render(makeTarget(el), 'abc123', emptyContext())).toBe(false);
    expect(el.src).toBe('https://cdn.example.com/before.jpg');
  });
});
