/**
 * `image` field renderer.
 *
 * For `<img>` elements: set `src`/`alt` from the value (which may be a
 * Payload media object or a plain URL string).
 *
 * For other elements: set the CSS `background-image` with CSS-escaped
 * URL — combined with `isSafeUrl()` this eliminates the CSS-injection
 * vector and lets consumers style hero sections with background images.
 *
 * @module @field-types/image
 */

import { escapeCssUrl } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import type { FieldRenderer } from '@core/types';
import type { PayloadMedia } from './types';
import { registerBuiltinRenderer } from './registry';

const imageRenderer: FieldRenderer = {
  name: 'image',
  render(target, value, context) {
    const element = target.element;
    const media = readMedia(value);
    const url = pickUrl(media, value);
    if (url === undefined) return;
    if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      img.src = url;
      const alt = pickAlt(media, target.altField, context.allFields);
      if (alt !== undefined) img.alt = alt;
      return;
    }
    (element as HTMLElement).style.backgroundImage = `url('${escapeCssUrl(url)}')`;
  },
};

function readMedia(value: unknown): PayloadMedia | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value;
}

function pickUrl(media: PayloadMedia | undefined, value: unknown): string | undefined {
  if (media?.url !== undefined && isSafeUrl(media.url)) return media.url;
  if (typeof value === 'string' && isSafeUrl(value)) return value;
  return undefined;
}

function pickAlt(
  media: PayloadMedia | undefined,
  altField: string | undefined,
  allFields: Record<string, unknown>,
): string | undefined {
  if (media?.alt !== undefined) return media.alt;
  if (altField !== undefined) {
    const sibling = allFields[altField];
    if (typeof sibling === 'string') return sibling;
  }
  return undefined;
}

registerBuiltinRenderer(imageRenderer);

export { imageRenderer };
