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
import { resolveFieldValue } from '@core/field-value';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';
import type { PayloadMedia } from './types';

const imageRenderer: FieldRenderer = {
  name: 'image',
  render: /* @__PURE__ */ markNoWriteCallback((target, value, context) => {
    const element = target.element;
    const media = readMedia(value);
    const preferLocale = target.locale !== undefined;
    const url = pickUrl(
      media,
      value,
      target.srcField,
      context.allFields,
      context.locale,
      preferLocale,
    );
    if (url === undefined) return false;
    if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      img.src = url;
      const alt = pickAlt(media, target.altField, context.allFields, context.locale, preferLocale);
      if (alt !== undefined) img.alt = alt;
      return;
    }
    (element as HTMLElement).style.backgroundImage = `url('${escapeCssUrl(url)}')`;
    return;
  }),
};

function readMedia(value: unknown): PayloadMedia | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value;
}

function pickUrl(
  media: PayloadMedia | undefined,
  value: unknown,
  srcField: string | undefined,
  allFields: Record<string, unknown>,
  locale: string | undefined,
  preferLocale: boolean,
): string | undefined {
  if (srcField !== undefined && srcField.length > 0) {
    const sibling = resolveFieldValue(allFields, srcField, locale, preferLocale);
    if (typeof sibling === 'string' && isSafeUrl(sibling)) return sibling;
    const siblingMedia = readMedia(sibling);
    if (siblingMedia?.url !== undefined && isSafeUrl(siblingMedia.url)) return siblingMedia.url;
    return undefined;
  }
  if (media?.url !== undefined && isSafeUrl(media.url)) return media.url;
  if (typeof value === 'string' && isSafeUrl(value)) return value;
  return undefined;
}

function pickAlt(
  media: PayloadMedia | undefined,
  altField: string | undefined,
  allFields: Record<string, unknown>,
  locale: string | undefined,
  preferLocale: boolean,
): string | undefined {
  if (altField !== undefined && altField.length > 0) {
    const sibling = resolveFieldValue(allFields, altField, locale, preferLocale);
    if (typeof sibling === 'string') return sibling;
    return undefined;
  }
  if (media?.alt !== undefined) return media.alt;
  return undefined;
}

export { imageRenderer };
