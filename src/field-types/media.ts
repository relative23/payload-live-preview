/** `<img>` writes shared by the image and upload renderers. */

import { isSafeUrl } from '@security/url-validator';
import { resolveMediaUrl, type MediaShape } from '@lexical/value-shapes';

const IMAGE_SOURCE_ATTRIBUTES = ['src', 'srcset', 'sizes'] as const;

/** One image a media document offers: the original, or one of its `sizes`. */
interface Source {
  readonly name?: string;
  readonly url: string;
  readonly width: number;
  readonly height?: number | undefined;
  readonly mimeType?: string | undefined;
}

/** The size each `<img>` was last written with, so the next image the editor picks gets the same one. */
const chosenSizes = new WeakMap<HTMLImageElement, string>();

export function clearImage(img: HTMLImageElement): void {
  for (const name of IMAGE_SOURCE_ATTRIBUTES) img.removeAttribute(name);
  dropPictureSources(img);
}

/** A `<picture>`'s `<source>` wins over any `src`, and it still names the old image. */
function dropPictureSources(img: HTMLImageElement): void {
  if (img.parentElement?.tagName !== 'PICTURE') return;
  for (const source of img.parentElement.querySelectorAll('source')) source.remove();
}

/**
 * A server-rendered `srcset` would keep winning over a new `src`, so it is
 * rebuilt or removed together with `sizes`. It offers the picture the element
 * shows: the size whose URL the element's `src` is — the template's choice, or
 * the last write's once the editor picks another image — else the original,
 * and of the rest only what has its shape and format, one per width. A crop
 * of another shape is another picture. `url` is already resolved; the sizes
 * are resolved against `serverURL`. A `<picture>` keeps its sources while the
 * image is still the one they were drawn for.
 */
export function writeImage(
  img: HTMLImageElement,
  url: string,
  media: MediaShape | undefined,
  serverURL?: string,
): void {
  const sizes = sizeSources(media, serverURL);
  const shown = img.getAttribute('src');
  const chosen =
    sizes.find((size) => shown !== null && sameUrl(img, size.url, shown)) ??
    sizes.find((size) => size.name === chosenSizes.get(img));
  if (chosen?.name === undefined) chosenSizes.delete(img);
  else chosenSizes.set(img, chosen.name);
  if (shown === null || (chosen === undefined && !sameUrl(img, url, shown))) {
    dropPictureSources(img);
  }
  img.src = chosen?.url ?? url;
  const shape = chosen ?? media;
  const candidates = sizes.filter((size) => sameShape(size, shape));
  if (candidates.length === 0) {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    return;
  }
  if (typeof media?.width === 'number' && typeof media.url === 'string') {
    const original = resolveMediaUrl(media.url, serverURL);
    const source = { ...media, url: original, width: media.width };
    if (isSafeUrl(original) && sameShape(source, shape)) candidates.push(source);
  }
  // Two candidates of one width say nothing the first does not; the browser keeps the first anyway.
  const widths = new Set<number>();
  const parts: string[] = [];
  for (const source of candidates) {
    if (widths.has(source.width)) continue;
    widths.add(source.width);
    parts.push(`${srcsetUrl(source.url)} ${String(source.width)}w`);
  }
  const srcset = parts.join(', ');
  img.setAttribute('srcset', srcset);
}

function sizeSources(media: MediaShape | undefined, serverURL: string | undefined): Source[] {
  const sources: Source[] = [];
  for (const [name, size] of Object.entries(media?.sizes ?? media?.variants ?? {})) {
    if (typeof size.url !== 'string' || typeof size.width !== 'number') continue;
    const url = resolveMediaUrl(size.url, serverURL);
    if (isSafeUrl(url)) sources.push({ ...size, name, url, width: size.width });
  }
  return sources;
}

function sameUrl(img: HTMLImageElement, a: string, b: string): boolean {
  try {
    return new URL(a, img.baseURI).href === new URL(b, img.baseURI).href;
  } catch {
    return a === b;
  }
}

/**
 * Whether `source` is the same picture as `shape` at another width. What
 * either leaves out cannot tell them apart. Payload scales a size's height
 * from the original's and rounds it, so a pixel at the larger width is the
 * same shape.
 */
function sameShape(
  source: Partial<Source>,
  shape: (Pick<Source, 'height' | 'mimeType'> & { readonly width?: number }) | undefined,
): boolean {
  if (shape === undefined) return true;
  if (
    typeof source.mimeType === 'string' &&
    typeof shape.mimeType === 'string' &&
    source.mimeType !== shape.mimeType
  ) {
    return false;
  }
  const { width, height } = shape;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    typeof source.width !== 'number' ||
    typeof source.height !== 'number'
  ) {
    return true;
  }
  return Math.abs(source.width * height - source.height * width) <= Math.max(width, source.width);
}

// Commas and whitespace delimit srcset candidates and cannot appear raw in a URL there.
function srcsetUrl(url: string): string {
  return url.replace(/[\s,]/g, encodeURIComponent);
}
