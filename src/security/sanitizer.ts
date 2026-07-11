/**
 * HTML sanitizer.
 *
 * Uses the browser's parser (via `<template>`) for accurate sanitization
 * and walks the resulting DOM tree to:
 *
 *   1. Strip elements not on the allow-list (scripts removed entirely;
 *      others are unwrapped to their text content).
 *   2. Strip every attribute not on the per-tag allow-list, including
 *      every `on*` event handler.
 *   3. Validate `href`, `src`, and `srcset` values via `isSafeUrl`.
 *   4. Force `rel="noopener noreferrer"` on external `<a>` elements.
 *   5. Strip `<style>` and any inline `style` attributes entirely
 *      (CSS-injection vector eliminated).
 *
 * The DOM dependency is intentional — string-only sanitizers are
 * historically brittle. The function throws `SanitizerEnvironmentError`
 * when no DOM is available so callers fail loudly instead of producing
 * unsanitized output.
 *
 * @module @security/sanitizer
 */

import { isSafeUrl, isExternalHttpUrl } from './url-validator';

/**
 * HTML elements that pass through sanitization with their content
 * intact. Anything not in this set is unwrapped (text preserved,
 * markup removed) unless it is on the `REMOVE_COMPLETELY` set, in
 * which case it is deleted with its children.
 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'mark',
  'small',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'blockquote',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'a',
  'span',
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'figure',
  'figcaption',
  'img',
  'picture',
  'source',
  'audio',
  'video',
  'sub',
  'sup',
  'hr',
  'time',
  'abbr',
  'cite',
  'q',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
]);

/**
 * Elements removed entirely (children included). Distinct from the
 * unwrapping fallback because their contents are themselves harmful
 * (script source, CSS, raw HTML, etc.).
 */
const REMOVE_COMPLETELY: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'template',
  'frame',
  'frameset',
  'noframes',
  'noscript',
]);

const ATTR_GLOBAL: ReadonlySet<string> = new Set([
  'id',
  'class',
  'lang',
  'dir',
  'title',
  'role',
  'tabindex',
]);

const ATTR_ARIA_PREFIX = 'aria-';
const ATTR_DATA_PREFIX = 'data-';

const ATTR_BY_TAG: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'target', 'rel', 'download', 'hreflang', 'type']),
  img: new Set(['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding']),
  picture: new Set([]),
  source: new Set(['src', 'srcset', 'sizes', 'type', 'media']),
  audio: new Set(['src', 'controls', 'autoplay', 'loop', 'muted', 'preload']),
  video: new Set([
    'src',
    'poster',
    'controls',
    'autoplay',
    'loop',
    'muted',
    'preload',
    'width',
    'height',
    'playsinline',
  ]),
  time: new Set(['datetime']),
  abbr: new Set(['title']),
  q: new Set(['cite']),
  blockquote: new Set(['cite']),
  table: new Set(['summary']),
  th: new Set(['colspan', 'rowspan', 'scope', 'headers', 'abbr']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'reversed', 'type']),
  li: new Set(['value']),
  code: new Set(['class']),
  pre: new Set(['class']),
};

const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'src', 'cite', 'poster']);

/**
 * Thrown when `sanitizeHtml` is invoked in an environment without a
 * `document` (e.g., server-side rendering). Callers should catch this
 * and either degrade to plain-text rendering or route the work to a
 * deferred client-side render.
 */
export class SanitizerEnvironmentError extends Error {
  override readonly name = 'SanitizerEnvironmentError';
}

export interface SanitizeOptions {
  /** Extra tags to allow beyond the built-in list. Lower-case, untrimmed. */
  readonly additionalAllowedTags?: readonly string[];
  /** Extra per-tag attributes to allow. Tag and attribute names must be lower-case. */
  readonly additionalAllowedAttributes?: Readonly<Record<string, readonly string[]>>;
}

interface ResolvedPolicy {
  readonly allowedTags: ReadonlySet<string>;
  readonly attrByTag: ReadonlyMap<string, ReadonlySet<string>>;
}

function resolvePolicy(options: SanitizeOptions | undefined): ResolvedPolicy {
  if (!options) {
    const attrMap = new Map<string, ReadonlySet<string>>();
    for (const [tag, attrs] of Object.entries(ATTR_BY_TAG)) attrMap.set(tag, attrs);
    return { allowedTags: ALLOWED_TAGS, attrByTag: attrMap };
  }
  const allowed = new Set(ALLOWED_TAGS);
  for (const tag of options.additionalAllowedTags ?? []) allowed.add(tag);
  const attrMap = new Map<string, ReadonlySet<string>>();
  for (const [tag, attrs] of Object.entries(ATTR_BY_TAG)) attrMap.set(tag, attrs);
  for (const [tag, attrs] of Object.entries(options.additionalAllowedAttributes ?? {})) {
    const existing = attrMap.get(tag);
    const merged = new Set(existing ?? []);
    for (const attr of attrs) merged.add(attr);
    attrMap.set(tag, merged);
  }
  return { allowedTags: allowed, attrByTag: attrMap };
}

/**
 * Minimal `Document`-shaped surface the sanitizer needs. Any DOM
 * implementation (browser, jsdom, linkedom, happy-dom, parse5 + a
 * thin adapter) that produces `<template>`-style elements works.
 */
export interface SanitizerDocument {
  createElement: (tagName: string) => {
    innerHTML: string;
    readonly content: ParentNode;
  };
}

let documentOverride: SanitizerDocument | undefined;

/**
 * Inject a `Document` implementation for the sanitizer to use when
 * `globalThis.document` is unavailable.
 *
 * Server-side renderers (Node, Bun, Deno without DOM globals) can wire
 * this up once at startup with any of the popular pure-JS DOM
 * libraries:
 *
 *   ```ts
 *   // linkedom — recommended (smallest, fastest)
 *   import { parseHTML } from 'linkedom';
 *   import { setSanitizerDocument } from 'payload-live-preview';
 *   const { document } = parseHTML('<!doctype html><html><body></body></html>');
 *   setSanitizerDocument(document);
 *   ```
 *
 *   ```ts
 *   // jsdom — heavier, but already in many SSR pipelines
 *   import { JSDOM } from 'jsdom';
 *   setSanitizerDocument(new JSDOM().window.document);
 *   ```
 *
 * Pass `null` to clear a previous override (mostly useful for tests).
 */
export function setSanitizerDocument(doc: SanitizerDocument | null): void {
  documentOverride = doc ?? undefined;
}

/**
 * Sanitize `html` and return safe HTML.
 *
 * The function never returns `undefined`/`null`. On malformed input the
 * browser parser silently recovers and the sanitizer continues from
 * the recovered tree.
 *
 * @throws {SanitizerEnvironmentError} when no DOM is available.
 */
export function sanitizeHtml(html: string, options?: SanitizeOptions): string {
  const doc = resolveDocument();
  if (!doc) {
    throw new SanitizerEnvironmentError(
      'sanitizeHtml requires a DOM. Inject one via setSanitizerDocument() for SSR ' +
        '(linkedom, jsdom, happy-dom, …) or use the plain-text path on the server.',
    );
  }
  if (html === '') return '';

  const policy = resolvePolicy(options);
  const template = doc.createElement('template');
  template.innerHTML = html;
  sanitizeFragment(template.content, policy);
  return template.innerHTML;
}

function resolveDocument(): SanitizerDocument | undefined {
  if (documentOverride) return documentOverride;
  if (typeof document === 'undefined') return undefined;
  return document;
}

/**
 * Whether `sanitizeHtml` currently has a DOM to work with — either the
 * global `document` or an override injected via `setSanitizerDocument`.
 * Callers that treat sanitization as an optional defence-in-depth layer
 * (e.g. `lexicalToHtml` during SSR) use this to decide whether the
 * backstop is available instead of probing the `document` global
 * directly, which would ignore the override.
 */
export function hasSanitizerDocument(): boolean {
  return resolveDocument() !== undefined;
}

function sanitizeFragment(node: ParentNode, policy: ResolvedPolicy): void {
  // Iterate over a snapshot — we mutate children during the walk.
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      sanitizeElement(child as Element, policy);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  }
}

function sanitizeElement(element: Element, policy: ResolvedPolicy): void {
  const tag = element.tagName.toLowerCase();

  if (REMOVE_COMPLETELY.has(tag)) {
    element.remove();
    return;
  }

  if (!policy.allowedTags.has(tag)) {
    // Unwrap: replace element with its sanitized children.
    sanitizeFragment(element, policy);
    const parent = element.parentNode;
    if (parent) {
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      element.remove();
    }
    return;
  }

  sanitizeAttributes(element, tag, policy);

  // Apply rel hardening to external links after attribute sanitization.
  if (tag === 'a') hardenAnchor(element);

  sanitizeFragment(element, policy);
}

function sanitizeAttributes(element: Element, tag: string, policy: ResolvedPolicy): void {
  const tagAttrs = policy.attrByTag.get(tag);

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    // Strip every event-handler attribute.
    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
      continue;
    }
    // Strip every style attribute — CSS-injection vector.
    if (name === 'style') {
      element.removeAttribute(attr.name);
      continue;
    }
    // Allow global, ARIA, and data-* attributes universally. They can
    // carry arbitrary strings but no executable sinks (event handlers
    // and `style` were already stripped above).
    if (
      ATTR_GLOBAL.has(name) ||
      name.startsWith(ATTR_ARIA_PREFIX) ||
      name.startsWith(ATTR_DATA_PREFIX)
    ) {
      continue;
    }
    if (tagAttrs?.has(name)) {
      if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attr.value)) {
        element.removeAttribute(attr.name);
      } else if (name === 'srcset' && !isSafeSrcset(attr.value)) {
        element.removeAttribute(attr.name);
      }
      continue;
    }
    element.removeAttribute(attr.name);
  }
}

/**
 * Validate every candidate URL inside a `srcset` value. The attribute
 * holds a comma-separated list of `<url> [<descriptor>]` pairs; each
 * URL must individually pass `isSafeUrl`. Rejecting the whole
 * attribute on any bad candidate is deliberate — partial rewriting
 * would silently change rendering semantics.
 */
function isSafeSrcset(value: string): boolean {
  const candidates = value.split(',');
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    const url = trimmed.split(/\s+/, 1)[0];
    if (url === undefined || url.length === 0 || !isSafeUrl(url)) return false;
  }
  return true;
}

function hardenAnchor(anchor: Element): void {
  const href = anchor.getAttribute('href');
  if (!href) return;
  if (!isExternalHttpUrl(href)) return;
  anchor.setAttribute('rel', 'noopener noreferrer');
  if (!anchor.hasAttribute('target')) anchor.setAttribute('target', '_blank');
}

/**
 * Built-in allow-lists, exposed for documentation and tests.
 */
export const SANITIZER_POLICY = Object.freeze({
  allowedTags: ALLOWED_TAGS,
  removeCompletely: REMOVE_COMPLETELY,
  globalAttributes: ATTR_GLOBAL,
  attributesByTag: ATTR_BY_TAG,
  urlAttributes: URL_ATTRIBUTES,
});
