/** `<img>` writes shared by the image and upload renderers. */

import { isSafeUrl } from '@security/url-validator';
import type { MediaShape } from '@lexical/value-shapes';

const IMAGE_SOURCE_ATTRIBUTES = ['src', 'srcset', 'sizes'] as const;

export function clearImage(img: HTMLImageElement): void {
  for (const name of IMAGE_SOURCE_ATTRIBUTES) img.removeAttribute(name);
}

/**
 * A server-rendered `srcset` would keep winning over a new `src`, so it is
 * rebuilt from the media's `sizes` or removed together with `sizes`.
 */
export function writeImage(
  img: HTMLImageElement,
  url: string,
  media: MediaShape | undefined,
): void {
  img.src = url;
  const srcset = buildSrcset(media);
  if (srcset === undefined) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    return;
  }
  img.setAttribute('srcset', srcset);
}

function buildSrcset(media: MediaShape | undefined): string | undefined {
  if (media?.sizes === undefined) return undefined;
  const candidates: string[] = [];
  for (const size of Object.values(media.sizes)) {
    if (typeof size.url !== 'string' || typeof size.width !== 'number' || !isSafeUrl(size.url)) {
      continue;
    }
    candidates.push(`${srcsetUrl(size.url)} ${String(size.width)}w`);
  }
  if (candidates.length === 0) return undefined;
  if (typeof media.width === 'number' && typeof media.url === 'string' && isSafeUrl(media.url)) {
    candidates.push(`${srcsetUrl(media.url)} ${String(media.width)}w`);
  }
  return candidates.join(', ');
}

// Commas and whitespace delimit srcset candidates and cannot appear raw in a URL there.
function srcsetUrl(url: string): string {
  return url.replace(/[\s,]/g, encodeURIComponent);
}
