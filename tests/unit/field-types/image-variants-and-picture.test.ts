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
});
