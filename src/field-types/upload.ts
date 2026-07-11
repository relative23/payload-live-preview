/**
 * `upload` field renderer.
 *
 * Treats the value like an image upload when bound to an `<img>` element,
 * otherwise renders a download-style anchor with the filename.
 *
 * @module @field-types/upload
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import type { FieldRenderer } from '@core/types';
import type { PayloadMedia } from './types';
import { registerBuiltinRenderer } from './registry';

const uploadRenderer: FieldRenderer = {
  name: 'upload',
  render(target, value) {
    const element = target.element;
    const media = readMedia(value);
    if (media === undefined) return;
    const url = media.url;
    if (typeof url !== 'string' || !isSafeUrl(url)) return;
    if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      img.src = url;
      if (media.alt !== undefined) img.alt = media.alt;
      return;
    }
    if (element.tagName === 'A') {
      const anchor = element as HTMLAnchorElement;
      anchor.href = url;
      anchor.textContent = media.filename ?? url;
      return;
    }
    const label = media.filename !== undefined ? escapeHtml(media.filename) : escapeHtml(url);
    element.innerHTML = `<a href="${escapeHtmlAttribute(url)}">${label}</a>`;
  },
};

function readMedia(value: unknown): PayloadMedia | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value;
}

registerBuiltinRenderer(uploadRenderer);

export { uploadRenderer };
