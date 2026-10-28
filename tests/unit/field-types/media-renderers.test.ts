import { describe, expect, it, vi } from 'vitest';
import type { RenderContext } from '@core/types';
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

describe('media renderers — a path on the Payload server', () => {
  // Payload returns a media `url` as a path on its own origin unless its config sets `serverURL`.
  // The admin resolves that path against the server; the preview is on another origin.
  const SERVER = 'https://cms.example.com';
  const withServer = (allFields: Record<string, unknown> = {}): RenderContext => ({
    ...emptyContext(allFields),
    serverURL: SERVER,
  });
  const media = {
    url: '/api/media/file/a.jpg',
    alt: 'x',
    filename: 'a.jpg',
    width: 1600,
    sizes: { thumb: { url: '/api/media/file/a-400x300.jpg', width: 400 } },
  };

  it('resolves an upload on <img>, in src and in every srcset candidate', () => {
    const el = document.createElement('img');
    rendererNamed('upload').render(makeTarget(el), media, withServer());
    expect(el.getAttribute('src')).toBe('https://cms.example.com/api/media/file/a.jpg');
    expect(el.getAttribute('srcset')).toBe(
      'https://cms.example.com/api/media/file/a-400x300.jpg 400w, https://cms.example.com/api/media/file/a.jpg 1600w',
    );
  });

  it('resolves an upload on <a> and in the anchor it injects elsewhere', () => {
    const link = document.createElement('a');
    rendererNamed('upload').render(makeTarget(link), media, withServer());
    expect(link.getAttribute('href')).toBe('https://cms.example.com/api/media/file/a.jpg');
    expect(link.textContent).toBe('a.jpg');

    const block = document.createElement('div');
    rendererNamed('upload').render(makeTarget(block), media, withServer());
    expect(block.innerHTML).toContain('<a href="https://cms.example.com/api/media/file/a.jpg"');
  });

  it('resolves an image given as a media object, on <img> and as a background', () => {
    const img = document.createElement('img');
    rendererNamed('image').render(makeTarget(img), media, withServer());
    expect(img.getAttribute('src')).toBe('https://cms.example.com/api/media/file/a.jpg');
    expect(img.getAttribute('srcset')).toContain(
      'https://cms.example.com/api/media/file/a-400x300.jpg 400w',
    );

    const box = document.createElement('div');
    rendererNamed('image').render(makeTarget(box), media, withServer());
    expect(box.style.backgroundImage).toMatch(
      /url\(["']?https:\/\/cms\.example\.com\/api\/media\/file\/a\.jpg["']?\)/,
    );
  });

  it('writes the path as delivered when the runtime knows no server', () => {
    const el = document.createElement('img');
    rendererNamed('upload').render(makeTarget(el), media, emptyContext());
    expect(el.getAttribute('src')).toBe('/api/media/file/a.jpg');
    expect(el.getAttribute('srcset')).toContain('/api/media/file/a-400x300.jpg 400w');
    expect(el.getAttribute('srcset')).not.toContain('cms.example.com');
  });

  it.each([
    ['an absolute URL', 'https://cdn.example.com/a.jpg'],
    ['a protocol-relative URL', '//cdn.example.com/a.jpg'],
    ['a backslash that the URL parser reads as a second slash', '/\\cdn.example.com/a.jpg'],
  ])('leaves %s as it is', (_name, url) => {
    const el = document.createElement('img');
    rendererNamed('upload').render(makeTarget(el), { url }, withServer());
    expect(el.getAttribute('src')).toBe(url);
  });

  it('leaves a URL that is not a media document as the page wrote it', () => {
    // A plain string and a sibling text field hold what an author typed: relative to the site.
    const plain = document.createElement('img');
    rendererNamed('image').render(makeTarget(plain), '/img/hero.jpg', withServer());
    expect(plain.getAttribute('src')).toBe('/img/hero.jpg');

    const sibling = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(sibling, { srcField: 'assetUrl' }),
      'label',
      withServer({ assetUrl: '/img/sibling.jpg' }),
    );
    expect(sibling.getAttribute('src')).toBe('/img/sibling.jpg');
  });

  it.each(['not a url', 'javascript:alert(1)', ''])(
    'keeps the path when %j cannot resolve it',
    (serverURL) => {
      const el = document.createElement('img');
      rendererNamed('upload').render(makeTarget(el), media, { ...emptyContext(), serverURL });
      expect(el.getAttribute('src')).toBe('/api/media/file/a.jpg');
    },
  );
});

/**
 * Site audit of 27.10.2026, B3. A string is an image source only when it can
 * name one; a binding whose alt is its own field holds alt text; and the
 * rebuilt `srcset` offers the browser only the picture the element shows.
 */
describe('image renderer — what the element is given', () => {
  it.each([
    ['alt text', 'Partner GmbH'],
    ['a document id', '6721f3a9c2e4b5d6e7f80912'],
    ['a number as text', '16'],
  ])('does not write %s as src', (_case, value) => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://cdn.example.com/logo.png');
    expect(rendererNamed('image').render(makeTarget(el), value, emptyContext())).toBe(false);
    expect(el.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
  });

  it.each([
    ['a file name', 'logo.png'],
    ['a path', '/img/logo'],
    ['an absolute URL', 'https://cdn.example.com/logo'],
  ])('writes %s as src', (_case, value) => {
    const el = document.createElement('img');
    rendererNamed('image').render(makeTarget(el), value, emptyContext());
    expect(el.getAttribute('src')).toBe(value);
  });

  it('writes the value as alt alone when the binding reads its alt from its own field', () => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://cdn.example.com/logo.png');
    rendererNamed('image').render(
      makeTarget(el, { fieldName: 'partners.0.name', altField: 'partners.0.name' }),
      'Partner GmbH',
      emptyContext({ partners: [{ name: 'Partner GmbH' }] }),
    );
    expect(el.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
    expect(el.alt).toBe('Partner GmbH');
  });
});

describe('image renderer — the picture the element shows', () => {
  // The shape of a Payload upload collection with crops, a format variant and two sizes of one width.
  const jpeg = (name: string, width: number, height: number) => ({
    url: `https://cdn.example.com/${name}`,
    width,
    height,
    mimeType: 'image/jpeg',
  });
  const photo = {
    ...jpeg('photo.jpg', 1600, 1067),
    sizes: {
      thumbnail: jpeg('photo-400x300.jpg', 400, 300),
      square: jpeg('photo-800x800.jpg', 800, 800),
      card: jpeg('photo-900x600.jpg', 900, 600),
      cardAvif: { ...jpeg('photo-900x600.avif', 900, 600), mimeType: 'image/avif' },
      cardCopy: jpeg('photo-900x601.jpg', 900, 601),
      portrait: jpeg('photo-900x1200.jpg', 900, 1200),
      og: jpeg('photo-1200x630.jpg', 1200, 630),
      wide: jpeg('photo-1200x800.jpg', 1200, 800),
    },
  };

  it('offers only the sizes in the original shape and format, one per width', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(makeTarget(el), photo, emptyContext());
    expect(el.getAttribute('src')).toBe('https://cdn.example.com/photo.jpg');
    expect(el.getAttribute('srcset')).toBe(
      'https://cdn.example.com/photo-900x600.jpg 900w, https://cdn.example.com/photo-1200x800.jpg 1200w, https://cdn.example.com/photo.jpg 1600w',
    );
  });

  it('keeps the size the template chose, and offers that crop', () => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://cdn.example.com/photo-800x800.jpg');
    rendererNamed('image').render(makeTarget(el), photo, emptyContext());
    expect(el.getAttribute('src')).toBe('https://cdn.example.com/photo-800x800.jpg');
    expect(el.getAttribute('srcset')).toBe('https://cdn.example.com/photo-800x800.jpg 800w');
  });

  it('keeps that size when the editor picks another image', () => {
    const el = document.createElement('img');
    el.setAttribute('src', 'https://cdn.example.com/photo-900x600.jpg');
    const renderer = rendererNamed('image');
    renderer.render(makeTarget(el), photo, emptyContext());
    const other = JSON.parse(JSON.stringify(photo).replaceAll('photo', 'other')) as typeof photo;
    renderer.render(makeTarget(el), other, emptyContext());
    expect(el.getAttribute('src')).toBe('https://cdn.example.com/other-900x600.jpg');
  });

  it('keeps every size whose shape it cannot tell', () => {
    const el = document.createElement('img');
    rendererNamed('image').render(
      makeTarget(el),
      {
        url: 'https://cdn.example.com/a.jpg',
        width: 1600,
        sizes: {
          small: { url: 'https://cdn.example.com/a-400.jpg', width: 400 },
          crop: { url: 'https://cdn.example.com/a-800.jpg', width: 800, height: 800 },
        },
      },
      emptyContext(),
    );
    expect(el.getAttribute('srcset')).toBe(
      'https://cdn.example.com/a-400.jpg 400w, https://cdn.example.com/a-800.jpg 800w, https://cdn.example.com/a.jpg 1600w',
    );
  });
});
