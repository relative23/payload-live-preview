/**
 * Default block renderers for common Payload block patterns.
 *
 * The set covers what most Payload sites ship with `BlocksFeature`:
 *
 *   - **callout** — `<aside>` with `data-importance` for theming
 *   - **image-block** — `<figure>` + `<img>` + optional `<figcaption>`
 *   - **video-block** — `<figure>` + `<video>` with controls
 *   - **code-block** — `<pre><code class="language-…">`
 *   - **cta-block** — `<div>` with primary `<a>` button
 *
 * Each renderer:
 *
 *   - reads only well-known field names off `fields`, ignoring extras,
 *   - escapes every value (no raw HTML injection),
 *   - validates URLs through `isSafeUrl` before emitting them,
 *   - degrades gracefully when fields are missing (skips the element).
 *
 * The defaults are *opt-in*: consumers call `registerDefaultBlocks()`
 * from `@lexical/blocks/defaults`. This keeps the core bundle lean
 * for projects that have their own block-rendering pipeline.
 *
 * @module @lexical/blocks/defaults
 */

import { escapeHtml, escapeHtmlAttribute } from '@security/escape';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import type { LexicalNode } from '../types';
import { registerBlockRenderer, type BlockRenderer } from './registry';

/* ───────────────────────────── helpers ────────────────────────────── */

function str(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeUrlOrUndefined(fields: Record<string, unknown>, key: string): string | undefined {
  const raw = str(fields, key);
  return raw !== undefined && isSafeUrl(raw) ? raw : undefined;
}

function sanitizeIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

/* ──────────────────────────── renderers ───────────────────────────── */

/**
 * Callout — short attention block with severity styling.
 *
 * Fields (all optional except `text`):
 *   - `text`         — body text (or rich text — falls through to render-children)
 *   - `title`        — optional bold lead
 *   - `importance`   — `'info' | 'success' | 'warning' | 'danger'` (default `info`)
 */
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
  return `<aside class="lp-block-callout" data-importance="${escapeHtmlAttribute(importance)}">${titleHtml}${bodyHtml}</aside>`;
};

/**
 * Image block — `<figure>` with optional caption.
 *
 * Fields:
 *   - `image.url` / `imageUrl`        — required, validated
 *   - `image.alt` / `alt`             — used on `<img alt>`
 *   - `image.width` / `image.height`  — passed through for layout
 *   - `caption`                       — optional `<figcaption>` text
 */
const imageBlockRenderer: BlockRenderer = (fields) => {
  const media = readMedia(fields);
  const url = media?.url ?? safeUrlOrUndefined(fields, 'imageUrl');
  if (url === undefined || !isSafeUrl(url)) return '';
  const alt = media?.alt ?? str(fields, 'alt') ?? '';
  const width = typeof media?.width === 'number' ? ` width="${String(media.width)}"` : '';
  const height = typeof media?.height === 'number' ? ` height="${String(media.height)}"` : '';
  const caption = str(fields, 'caption');
  const captionHtml =
    caption !== undefined ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="lp-block-image"><img src="${escapeHtmlAttribute(url)}" alt="${escapeHtmlAttribute(alt)}"${width}${height} loading="lazy" decoding="async">${captionHtml}</figure>`;
};

/**
 * Video block — `<figure>` with `<video controls>`.
 *
 * Fields:
 *   - `video.url` / `videoUrl`        — required, validated
 *   - `video.mimeType` / `mimeType`   — for `<source type>`
 *   - `poster`                        — optional poster URL
 *   - `caption`                       — optional `<figcaption>`
 */
const videoBlockRenderer: BlockRenderer = (fields) => {
  const media = readMedia(fields, 'video');
  const url = media?.url ?? safeUrlOrUndefined(fields, 'videoUrl');
  if (url === undefined || !isSafeUrl(url)) return '';
  const mime = media?.mimeType ?? str(fields, 'mimeType');
  const typeAttr = mime !== undefined ? ` type="${escapeHtmlAttribute(mime)}"` : '';
  const poster = safeUrlOrUndefined(fields, 'poster');
  const posterAttr = poster !== undefined ? ` poster="${escapeHtmlAttribute(poster)}"` : '';
  const caption = str(fields, 'caption');
  const captionHtml =
    caption !== undefined ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="lp-block-video"><video controls${posterAttr}><source src="${escapeHtmlAttribute(url)}"${typeAttr}></video>${captionHtml}</figure>`;
};

/**
 * Code block — `<pre><code>` with optional language class.
 *
 * Fields:
 *   - `code` / `content` — required text (whitespace preserved)
 *   - `language`         — optional, sanitised to a-z0-9-_
 *   - `caption`          — optional pre-block label
 */
const codeBlockRenderer: BlockRenderer = (fields) => {
  const code = str(fields, 'code') ?? str(fields, 'content');
  if (code === undefined) return '';
  const language = sanitizeIdent(str(fields, 'language') ?? '');
  const langClass = language === '' ? '' : ` class="language-${language}"`;
  const caption = str(fields, 'caption');
  const labelHtml = caption !== undefined ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure class="lp-block-code">${labelHtml}<pre><code${langClass}>${escapeHtml(code)}</code></pre></figure>`;
};

/**
 * CTA block — call-to-action button + supporting text.
 *
 * Fields:
 *   - `label` / `text`      — button text (required)
 *   - `href` / `url`        — button target, validated
 *   - `secondaryLabel`      — optional second link
 *   - `secondaryHref`       — optional second target
 *   - `lead`                — small lead text above the buttons
 */
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

/* ─────────────────── helpers shared between renderers ─────────────── */

interface MediaShape {
  readonly url?: string;
  readonly alt?: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
}

function readMedia(
  fields: Record<string, unknown>,
  key: 'image' | 'video' = 'image',
): MediaShape | undefined {
  const candidate = fields[key];
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  return candidate;
}

function readLexicalChildren(fields: Record<string, unknown>): readonly LexicalNode[] | undefined {
  const body = fields['body'] ?? fields['content'];
  if (typeof body !== 'object' || body === null) return undefined;
  const root = (body as { root?: { children?: unknown } }).root;
  if (!root || !Array.isArray(root.children)) return undefined;
  return root.children as readonly LexicalNode[];
}

/* ───────────────────────────── public ─────────────────────────────── */

/**
 * Register all default block renderers in one call. Idempotent.
 *
 * Use this once at app start when you want the built-in block
 * rendering. Custom slugs can override or extend via
 * `registerBlockRenderer` from `@lexical/blocks/registry`.
 */
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
