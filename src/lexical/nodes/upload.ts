/**
 * Renderer for Lexical `upload` nodes — Payload's inline-media block.
 *
 * Recognises the standard Payload upload shape:
 *   {
 *     type: 'upload',
 *     relationTo: 'media',
 *     value: { url, alt, width, height, mimeType, ... },
 *   }
 *
 * Renders an `<img>` for raster/SVG MIME types, a `<video>` for video
 * MIME types, a fallback `<a>` link otherwise. URLs are validated by
 * `isSafeUrl` — unsafe URLs collapse to an empty string rather than
 * exposing the user to a redirect-style attack.
 *
 * @module @lexical/nodes/upload
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import { register, type NodeRenderer } from '../registry';

interface UploadValue {
  readonly url?: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly filename?: string;
}

const uploadRenderer: NodeRenderer = (node): string => {
  const value = readUploadValue(node);
  if (value === undefined) return '';
  const url = value.url;
  if (typeof url !== 'string' || !isSafeUrl(url)) return '';

  const mime = typeof value.mimeType === 'string' ? value.mimeType : '';
  if (mime.startsWith('video/')) return renderVideo(value, url);
  if (mime.startsWith('audio/')) return renderAudio(value, url);
  if (mime === '' || mime.startsWith('image/')) return renderImage(value, url);
  return renderFallbackLink(value, url);
};

register('upload', uploadRenderer);

export { uploadRenderer };

function readUploadValue(node: Record<string, unknown>): UploadValue | undefined {
  const raw = node['value'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  return raw;
}

function renderImage(value: UploadValue, url: string): string {
  const alt = typeof value.alt === 'string' ? escapeHtml(value.alt) : '';
  const width = typeof value.width === 'number' ? ` width="${String(value.width)}"` : '';
  const height = typeof value.height === 'number' ? ` height="${String(value.height)}"` : '';
  return `<img src="${escapeHtmlAttribute(url)}" alt="${alt}"${width}${height} loading="lazy" decoding="async">`;
}

function renderVideo(value: UploadValue, url: string): string {
  const width = typeof value.width === 'number' ? ` width="${String(value.width)}"` : '';
  const height = typeof value.height === 'number' ? ` height="${String(value.height)}"` : '';
  const type =
    typeof value.mimeType === 'string' ? ` type="${escapeHtmlAttribute(value.mimeType)}"` : '';
  return `<video controls${width}${height}><source src="${escapeHtmlAttribute(url)}"${type}></video>`;
}

function renderAudio(value: UploadValue, url: string): string {
  const type =
    typeof value.mimeType === 'string' ? ` type="${escapeHtmlAttribute(value.mimeType)}"` : '';
  return `<audio controls><source src="${escapeHtmlAttribute(url)}"${type}></audio>`;
}

function renderFallbackLink(value: UploadValue, url: string): string {
  const label = typeof value.filename === 'string' ? escapeHtml(value.filename) : escapeHtml(url);
  return `<a href="${escapeHtmlAttribute(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
