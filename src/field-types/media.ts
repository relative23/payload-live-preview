/** `<img>` writes shared by the image and upload renderers. */

import { isSafeUrl } from '@security/url-validator';
import { resolveMediaUrl, type MediaShape } from '@lexical/value-shapes';

const IMAGE_SOURCE_ATTRIBUTES = ['src', 'srcset', 'sizes'] as const;

export function clearImage(img: HTMLImageElement): void {
  for (const name of IMAGE_SOURCE_ATTRIBUTES) img.removeAttribute(name);
}

/**
 * A server-rendered `srcset` would keep winning over a new `src`, so it is
 * rebuilt from the media's `sizes` or removed together with `sizes`. `url` is
 * already resolved; the candidates of the `srcset` are resolved against `serverURL`.
 */
export function writeImage(
  img: HTMLImageElement,
  url: string,
  media: MediaShape | undefined,
  serverURL?: string,
): void {
  img.src = url;
  const srcset = buildSrcset(media, serverURL);
  if (srcset === undefined) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    return;
  }
  img.setAttribute('srcset', srcset);
}

function buildSrcset(
  media: MediaShape | undefined,
  serverURL: string | undefined,
): string | undefined {
  if (media?.sizes === undefined) return undefined;
  const candidates: string[] = [];
  for (const size of Object.values(media.sizes)) {
    if (typeof size.url !== 'string' || typeof size.width !== 'number') continue;
    const url = resolveMediaUrl(size.url, serverURL);
    if (!isSafeUrl(url)) continue;
    candidates.push(`${srcsetUrl(url)} ${String(size.width)}w`);
  }
  if (candidates.length === 0) return undefined;
  if (typeof media.width === 'number' && typeof media.url === 'string') {
    const url = resolveMediaUrl(media.url, serverURL);
    if (isSafeUrl(url)) candidates.push(`${srcsetUrl(url)} ${String(media.width)}w`);
  }
  return candidates.join(', ');
}

// Commas and whitespace delimit srcset candidates and cannot appear raw in a URL there.
function srcsetUrl(url: string): string {
  return url.replace(/[\s,]/g, encodeURIComponent);
}
