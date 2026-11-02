import { describe, expect, it } from 'vitest';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

/**
 * A string on an image binding is either an address or something that only looks
 * like text: a partner's name, a document id. A path with a space in it is an
 * address; the browser encodes the space.
 */
function render(value: string): { written: unknown; src: string | null } {
  const element = document.createElement('img');
  element.setAttribute('src', '/before.png');
  const written = rendererNamed('image').render(makeTarget(element), value, emptyContext());
  return { written, src: element.getAttribute('src') };
}

describe('a string on an image binding', () => {
  it.each([
    '/media/my photo.png',
    './media/my photo.png',
    '../media/my photo.png',
    'my photo.png',
    'My Photo.JPEG',
    '/media/my%20photo.png',
    './hero',
    'hero.png',
    'https://cdn.example.com/a.png',
  ])('writes %s as the address', (value) => {
    const { written, src } = render(value);
    expect(written).not.toBe(false);
    expect(src).not.toBe('/before.png');
  });

  it.each([
    'Acme',
    'Acme Corporation',
    'Note: the sleeping cat',
    'A cat. Sleeping on a chair',
    'Visit acme.com today',
    '64f1c2d3e4b5a69788796a5b',
    '42',
  ])('leaves %s alone: it names no address', (value) => {
    const { written, src } = render(value);
    expect(written).toBe(false);
    expect(src).toBe('/before.png');
  });
});
