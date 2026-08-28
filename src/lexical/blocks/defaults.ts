/**
 * Opt-in renderers for the block patterns most Payload sites ship (callout,
 * image, video, code, cta). Each reads well-known field names only, escapes
 * every value, validates URLs and renders nothing when a required field is
 * missing. Register with `registerDefaultBlocks()`.
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import type { LexicalNode } from '../types';
import { readMedia, sanitizeIdent, type MediaShape } from '../value-shapes';
import { registerBlockRenderer, type BlockRenderer } from './registry';

function str(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeUrlOrUndefined(fields: Record<string, unknown>, key: string): string | undefined {
  const raw = str(fields, key);
  return raw !== undefined && isSafeUrl(raw) ? raw : undefined;
}

function captionHtml(fields: Record<string, unknown>): string {
  const caption = str(fields, 'caption');
  return caption !== undefined ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
}

function dimensionAttributes(media: MediaShape | undefined): string {
  const width = typeof media?.width === 'number' ? ` width="${String(media.width)}"` : '';
  const height = typeof media?.height === 'number' ? ` height="${String(media.height)}"` : '';
  return `${width}${height}`;
}

/** Fields: `text` or a Lexical `body`/`content`, optional `title`, `importance` (default `info`). */
const calloutRenderer: BlockRenderer = (fields, ctx) => {
  const importance = sanitizeIdent(str(fields, 'importance') ?? 'info');
  const title = str(fields, 'title');
  const text = str(fields, 'text');
  const richText = readLexicalChildren(fields);

  const titleHtml = title !== undefined ? `<strong>${escapeHtml(title)}</strong>` : '';
  const bodyHtml =
    richText !== undefined
      ? ctx.renderChildren(richText)
      : text !== undefined
        ? `<p>${escapeHtml(text)}</p>`
        : '';
  return `<aside class="lp-block-callout lp-block-callout--${importance}">${titleHtml}${bodyHtml}</aside>`;
};

/** Fields: `image` (media) or `imageUrl`, `alt`, optional `caption`. */
const imageBlockRenderer: BlockRenderer = (fields) => {
  const media = readMedia(fields['image']);
  const url = media?.url ?? safeUrlOrUndefined(fields, 'imageUrl');
  if (url === undefined || !isSafeUrl(url)) return '';
  const alt = media?.alt ?? str(fields, 'alt') ?? '';
  return `<figure class="lp-block-image"><img src="${escapeHtmlAttribute(url)}" alt="${escapeHtmlAttribute(alt)}"${dimensionAttributes(media)} loading="lazy" decoding="async">${captionHtml(fields)}</figure>`;
};

/** Fields: `video` (media) or `videoUrl`, `mimeType`, optional `poster` and `caption`. */
const videoBlockRenderer: BlockRenderer = (fields) => {
  const media = readMedia(fields['video']);
  const url = media?.url ?? safeUrlOrUndefined(fields, 'videoUrl');
  if (url === undefined || !isSafeUrl(url)) return '';
  const mime = media?.mimeType ?? str(fields, 'mimeType');
  const typeAttr = mime !== undefined ? ` type="${escapeHtmlAttribute(mime)}"` : '';
  const poster = safeUrlOrUndefined(fields, 'poster');
  const posterAttr = poster !== undefined ? ` poster="${escapeHtmlAttribute(poster)}"` : '';
  return `<figure class="lp-block-video"><video controls${posterAttr}><source src="${escapeHtmlAttribute(url)}"${typeAttr}></video>${captionHtml(fields)}</figure>`;
};

/** Fields: `code` or `content`, optional `language` and `caption`. */
const codeBlockRenderer: BlockRenderer = (fields) => {
  const code = str(fields, 'code') ?? str(fields, 'content');
  if (code === undefined) return '';
  const language = sanitizeIdent(str(fields, 'language') ?? '');
  const langClass = language === '' ? '' : ` class="language-${language}"`;
  return `<figure class="lp-block-code">${captionHtml(fields)}<pre><code${langClass}>${escapeHtml(code)}</code></pre></figure>`;
};

/** Fields: `label`/`text` and `href`/`url`; optional `lead`, `secondaryLabel`, `secondaryHref`. */
const ctaBlockRenderer: BlockRenderer = (fields) => {
  const label = str(fields, 'label') ?? str(fields, 'text');
  const href = safeUrlOrUndefined(fields, 'href') ?? safeUrlOrUndefined(fields, 'url');
  if (label === undefined || href === undefined) return '';
  const lead = str(fields, 'lead');
  const leadHtml =
    lead !== undefined ? `<p class="lp-block-cta__lead">${escapeHtml(lead)}</p>` : '';

  const buttons = [renderCtaAnchor(label, href, true)];
  const secondaryLabel = str(fields, 'secondaryLabel');
  const secondaryHref = safeUrlOrUndefined(fields, 'secondaryHref');
  if (secondaryLabel !== undefined && secondaryHref !== undefined) {
    buttons.push(renderCtaAnchor(secondaryLabel, secondaryHref, false));
  }
  return `<div class="lp-block-cta">${leadHtml}<div class="lp-block-cta__actions">${buttons.join('')}</div></div>`;
};

function renderCtaAnchor(label: string, href: string, primary: boolean): string {
  const targetAttr = isExternalHttpUrl(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const variant = primary ? 'primary' : 'secondary';
  return `<a class="lp-block-cta__button lp-block-cta__button--${variant}" href="${escapeHtmlAttribute(href)}"${targetAttr}>${escapeHtml(label)}</a>`;
}

function readLexicalChildren(fields: Record<string, unknown>): readonly LexicalNode[] | undefined {
  const body = fields['body'] ?? fields['content'];
  if (typeof body !== 'object' || body === null) return undefined;
  const root = (body as { root?: { children?: unknown } }).root;
  if (!root || !Array.isArray(root.children)) return undefined;
  return root.children as readonly LexicalNode[];
}

/** Register every default block renderer under its kebab-, camel- and short slug. Idempotent. */
export function registerDefaultBlocks(): void {
  registerBlockRenderer('callout', calloutRenderer);
  registerBlockRenderer('image-block', imageBlockRenderer);
  registerBlockRenderer('imageBlock', imageBlockRenderer);
  registerBlockRenderer('image', imageBlockRenderer);
  registerBlockRenderer('video-block', videoBlockRenderer);
  registerBlockRenderer('videoBlock', videoBlockRenderer);
  registerBlockRenderer('video', videoBlockRenderer);
  registerBlockRenderer('code-block', codeBlockRenderer);
  registerBlockRenderer('codeBlock', codeBlockRenderer);
  registerBlockRenderer('code', codeBlockRenderer);
  registerBlockRenderer('cta-block', ctaBlockRenderer);
  registerBlockRenderer('ctaBlock', ctaBlockRenderer);
  registerBlockRenderer('cta', ctaBlockRenderer);
}

export {
  calloutRenderer,
  imageBlockRenderer,
  videoBlockRenderer,
  codeBlockRenderer,
  ctaBlockRenderer,
};
