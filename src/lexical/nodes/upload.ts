/**
 * `upload` renderer: `<img>` for image (or unknown) MIME types, `<video>` /
 * `<audio>` for media, a download link otherwise. An unsafe URL renders nothing.
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isSafeUrl } from '@security/url-validator';
import type { NodeRenderer } from '../registry';
import { readMedia, type MediaShape } from '../value-shapes';

const uploadRenderer: NodeRenderer = (node): string => {
  const value = readMedia(node['value']);
  if (value === undefined) return '';
  const url = value.url;
  if (typeof url !== 'string' || !isSafeUrl(url)) return '';

  const mime = typeof value.mimeType === 'string' ? value.mimeType : '';
  if (mime.startsWith('video/')) return renderVideo(value, url);
  if (mime.startsWith('audio/')) return renderAudio(value, url);
  if (mime === '' || mime.startsWith('image/')) return renderImage(value, url);
  return renderFallbackLink(value, url);
};

export { uploadRenderer };

function dimensionAttributes(value: MediaShape): string {
  const width = typeof value.width === 'number' ? ` width="${String(value.width)}"` : '';
  const height = typeof value.height === 'number' ? ` height="${String(value.height)}"` : '';
  return `${width}${height}`;
}

function typeAttribute(value: MediaShape): string {
  return typeof value.mimeType === 'string' ? ` type="${escapeHtmlAttribute(value.mimeType)}"` : '';
}

function renderImage(value: MediaShape, url: string): string {
  const alt = typeof value.alt === 'string' ? escapeHtml(value.alt) : '';
  return `<img src="${escapeHtmlAttribute(url)}" alt="${alt}"${dimensionAttributes(value)} loading="lazy" decoding="async">`;
}

function renderVideo(value: MediaShape, url: string): string {
  return `<video controls${dimensionAttributes(value)}><source src="${escapeHtmlAttribute(url)}"${typeAttribute(value)}></video>`;
}

function renderAudio(value: MediaShape, url: string): string {
  return `<audio controls><source src="${escapeHtmlAttribute(url)}"${typeAttribute(value)}></audio>`;
}

function renderFallbackLink(value: MediaShape, url: string): string {
  const label = typeof value.filename === 'string' ? escapeHtml(value.filename) : escapeHtml(url);
  return `<a href="${escapeHtmlAttribute(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
