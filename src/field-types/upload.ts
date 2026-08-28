/** `upload` renderer: an image on `<img>`, a download link on `<a>`, an injected link elsewhere. */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { trustedHtml } from '@security/trusted-types';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { FieldRenderer } from '@core/types';
import { readMedia } from '@lexical/value-shapes';
import { clearImage, writeImage } from './media';
import { acceptUrl } from './unsafe-url';
import { isEmptyValue } from './utils';

const uploadRenderer: FieldRenderer = {
  name: 'upload',
  render: /* @__PURE__ */ markNoWriteCallback((target, value) => {
    const element = target.element;
    if (isEmptyValue(value)) {
      clear(element);
      return;
    }
    const media = readMedia(value);
    if (media === undefined) return false;
    const outcome = acceptUrl(element, target.fieldName, media.url);
    if (outcome.kind === 'none') return false;
    if (outcome.kind === 'unsafe') {
      clear(element);
      return;
    }
    const url = outcome.url;
    if (element.tagName === 'IMG') {
      const img = element as HTMLImageElement;
      writeImage(img, url, media);
      if (media.alt !== undefined) img.alt = media.alt;
      return;
    }
    if (element.tagName === 'A') {
      element.setAttribute('href', url);
      element.textContent = media.filename ?? url;
      return;
    }
    const label = escapeHtml(media.filename ?? url);
    element.innerHTML = trustedHtml(`<a href="${escapeHtmlAttribute(url)}">${label}</a>`);
    return;
  }),
};

function clear(element: Element): void {
  if (element.tagName === 'IMG') {
    clearImage(element as HTMLImageElement);
    return;
  }
  element.removeAttribute('href');
  element.textContent = '';
}

export { uploadRenderer };
