/**
 * Payload 4 names an upload's resized copies `variants` where Payload 3 says
 * `sizes`, and a template may wrap the `<img>` in a `<picture>`, whose `<source>`
 * wins over any `src` the renderer writes.
 */

import { describe, expect, it } from 'vitest';
import { clearImage, writeImage } from '@field-types/media';

function place(html: string): HTMLImageElement {
  document.body.innerHTML = html;
  return document.querySelector('img')!;
}

const small = { url: '/m/a-400.png', width: 400, height: 300, mimeType: 'image/png' };
const original = { url: '/m/a.png', width: 800, height: 600, mimeType: 'image/png' };

describe('Payload 4 variants', () => {
  it('offers them as Payload 3 sizes are offered', () => {
    const img = place('<img src="/old.png">');
    writeImage(img, original.url, { ...original, variants: { small } });
    expect(img.getAttribute('srcset')).toBe('/m/a-400.png 400w, /m/a.png 800w');
  });

  it('keeps the variant the template chose', () => {
    const img = place('<img src="/m/a-400.png">');
    writeImage(img, original.url, { ...original, variants: { small } });
    expect(img.getAttribute('src')).toBe('/m/a-400.png');
  });
});

/**
 * The shape a real upload has under Payload 4.0.0-beta.6 with its sharp transformer
 * (read from a running admin on 2026-11-02): the original is a JPEG, its variants are
 * WebP, and a variant nobody generated stands there with every value null.
 */
const UPLOADED = {
  url: '/api/media/file/neu-1.jpg',
  mimeType: 'image/jpeg',
  width: 1600,
  height: 900,
  variants: {
    thumb: {
      url: '/api/media/file/neu-1-320x180.webp',
      width: 320,
      height: 180,
      mimeType: 'image/webp',
    },
    s: {
      url: '/api/media/file/neu-1-640x360.webp',
      width: 640,
      height: 360,
      mimeType: 'image/webp',
    },
    l: { url: null, width: null, height: null, mimeType: null },
  },
};

describe('a real Payload 4 upload', () => {
  it('offers its WebP variants beside the JPEG original, and skips the empty one', () => {
    const img = place('<img src="/old.png">');
    writeImage(img, UPLOADED.url, UPLOADED as never);
    expect(img.getAttribute('src')).toBe(UPLOADED.url);
    expect(img.getAttribute('srcset')).toBe(
      '/api/media/file/neu-1-320x180.webp 320w, /api/media/file/neu-1-640x360.webp 640w, ' +
        '/api/media/file/neu-1.jpg 1600w',
    );
  });

  it('keeps to one format where the sizes offer the format the element shows', () => {
    const img = place('<img src="/old.png">');
    const png = { url: '/m/a-400.png', width: 400, height: 300, mimeType: 'image/png' };
    const webp = { url: '/m/a-500.webp', width: 500, height: 375, mimeType: 'image/webp' };
    writeImage(img, original.url, { ...original, sizes: { png, webp } });
    expect(img.getAttribute('srcset')).toBe('/m/a-400.png 400w, /m/a.png 800w');
  });
});

describe('an <img> in a <picture>', () => {
  const PICTURE =
    '<picture><source srcset="/m/a.webp" type="image/webp"><img src="/m/a.png"></picture>';

  it('drops the sources when the editor picks another image, since they would win', () => {
    const img = place(PICTURE);
    writeImage(img, '/m/b.png', { url: '/m/b.png', width: 800 });
    expect(document.querySelector('source')).toBeNull();
    expect(img.getAttribute('src')).toBe('/m/b.png');
  });

  it('keeps them while the image is the one the server drew', () => {
    const img = place(PICTURE);
    writeImage(img, '/m/a.png', { url: '/m/a.png', width: 800 });
    expect(document.querySelector('source')?.getAttribute('srcset')).toBe('/m/a.webp');
  });

  it('keeps them while the image is a size of the one the server drew', () => {
    const img = place(
      '<picture><source srcset="/m/a.webp" type="image/webp"><img src="/m/a-400.png"></picture>',
    );
    writeImage(img, original.url, { ...original, sizes: { small } });
    expect(document.querySelector('source')).not.toBeNull();
  });

  it('drops them when the image is cleared, or the old one would stay', () => {
    const img = place(PICTURE);
    clearImage(img);
    expect(document.querySelector('source')).toBeNull();
  });

  it('touches no <source> outside its own <picture>', () => {
    document.body.innerHTML =
      '<video><source src="/v.mp4"></video><figure><img src="/m/a.png"></figure>';
    writeImage(document.querySelector('img')!, '/m/b.png', undefined);
    expect(document.querySelector('source')).not.toBeNull();
  });

  it('drops the sources when the new image has a size of the name the element kept', () => {
    const img = place(PICTURE);
    const first = { url: '/m/a-400.png', width: 400, height: 300 };
    writeImage(img, '/m/a.png', { ...original, sizes: { card: first } });
    img.setAttribute('src', '/m/a-400.png');
    writeImage(img, '/m/a.png', { ...original, sizes: { card: first } });
    expect(document.querySelector('source')).not.toBeNull();
    const next = { url: '/m/b-400.png', width: 400, height: 300 };
    writeImage(img, '/m/b.png', {
      url: '/m/b.png',
      width: 800,
      height: 600,
      sizes: { card: next },
    });
    expect(img.getAttribute('src')).toBe('/m/b-400.png');
    expect(document.querySelector('source')).toBeNull();
  });
});
