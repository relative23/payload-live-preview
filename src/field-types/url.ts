/**
 * `url` renderer and the factory the `email` renderer shares. On an `<a>` the
 * value (or the `data-payload-href` sibling) becomes `href`; the value is
 * always the visible text.
 */

import { resolveFieldValue } from '@core/field-value';
import type { FieldRenderer, RendererKey } from '@core/types';
import { acceptUrl } from './unsafe-url';
import { isEmptyValue, safeStringify } from './utils';

/** Build the link renderer named `name`; `toHref` derives the URL from the field value. */
export function createLinkRenderer(
  name: RendererKey,
  toHref: (value: string) => string = (value) => value,
): FieldRenderer {
  return {
    name,
    render(target, value, context) {
      const element = target.element;
      if (isEmptyValue(value)) {
        clear(element);
        return;
      }
      const text = safeStringify(value);
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        (element as HTMLInputElement | HTMLTextAreaElement).value = text;
        return;
      }
      if (element.tagName === 'A') {
        const hrefField = target.hrefField;
        const candidate =
          hrefField === undefined || hrefField.length === 0
            ? toHref(text)
            : resolveFieldValue(
                context.allFields,
                hrefField,
                context.locale,
                target.locale !== undefined,
              );
        const outcome = acceptUrl(element, target.fieldName, candidate);
        if (outcome.kind === 'safe') element.setAttribute('href', outcome.url);
        else if (outcome.kind === 'unsafe') element.removeAttribute('href');
      }
      element.textContent = text;
    },
  };
}

function clear(element: Element): void {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    (element as HTMLInputElement | HTMLTextAreaElement).value = '';
    return;
  }
  element.removeAttribute('href');
  element.textContent = '';
}

export const urlRenderer: FieldRenderer = createLinkRenderer('url');
