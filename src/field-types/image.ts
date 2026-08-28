/**
 * `image` renderer: `src`/`alt`/`srcset` on an `<img>`, a CSS background on
 * anything else. The value is a media object, a URL string, or resolved from
 * the `data-payload-src` / `data-payload-alt` sibling fields.
 */

import { escapeCssUrl } from '@security/escape';
import { resolveFieldValue } from '@core/field-value';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';
import { readMedia, type MediaShape } from '@lexical/value-shapes';
import { clearImage, writeImage } from './media';
import { acceptUrl } from './unsafe-url';
import { isEmptyValue } from './utils';

const imageRenderer: FieldRenderer = {
  name: 'image',
  render: /* @__PURE__ */ markNoWriteCallback((target, value, context) => {
    const element = target.element;
    if (isEmptyValue(value)) {
      clear(element);
      return;
    }
    const preferLocale = target.locale !== undefined;
    const { media, candidate } = pickSource(target, value, context, preferLocale);
    const outcome = acceptUrl(element, target.fieldName, candidate);
    if (outcome.kind === 'none') return false;
    if (outcome.kind === 'unsafe') {
      clear(element);
      return;
    }
    if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      writeImage(img, outcome.url, media);
      const alt = pickAlt(media, target.altField, context.allFields, context.locale, preferLocale);
      if (alt !== undefined) img.alt = alt;
      return;
    }
    (element as HTMLElement).style.backgroundImage = `url('${escapeCssUrl(outcome.url)}')`;
    return;
  }),
};

function clear(element: Element): void {
  if (element.tagName === 'IMG') clearImage(element as HTMLImageElement);
  else (element as HTMLElement).style.backgroundImage = '';
}

function pickSource(
  target: CachedElement,
  value: unknown,
  context: RenderContext,
  preferLocale: boolean,
): { readonly media: MediaShape | undefined; readonly candidate: unknown } {
  const source =
    target.srcField !== undefined && target.srcField.length > 0
      ? resolveFieldValue(context.allFields, target.srcField, context.locale, preferLocale)
      : value;
  const media = readMedia(source);
  return { media, candidate: media === undefined ? source : media.url };
}

function pickAlt(
  media: MediaShape | undefined,
  altField: string | undefined,
  allFields: Record<string, unknown>,
  locale: string | undefined,
  preferLocale: boolean,
): string | undefined {
  if (altField !== undefined && altField.length > 0) {
    const sibling = resolveFieldValue(allFields, altField, locale, preferLocale);
    return typeof sibling === 'string' ? sibling : undefined;
  }
  return media?.alt;
}

export { imageRenderer };
