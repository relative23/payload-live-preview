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

import { trustedHtml } from './trusted-types';
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
/** Tags `allowFormControls` un-drops for author templates; `form` is deliberately not among them. */
const FORM_CONTROLS: ReadonlySet<string> = new Set([
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'label',
]);

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
const BINDING_DATA_PREFIX = 'data-payload-';

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

// DOM nodeType values are standardized across realms. Numeric constants keep
// an injected SSR document independent from a browser-global `Node` constructor.
const ELEMENT_NODE = 1;
const COMMENT_NODE = 8;

/**
 * Thrown when `sanitizeHtml` is invoked in an environment without a
 * `document` (e.g., server-side rendering). Callers should catch this
 * and either degrade to plain-text rendering or route the work to a
 * deferred client-side render.
 */
export class SanitizerEnvironmentError extends Error {
  override readonly name = 'SanitizerEnvironmentError';
}

/**
 * `'compat'` is the 1.x policy: `id` and every `data-*` attribute pass.
 * `'strict'` is the 2.0 policy, available now: `id` and `name` are stripped
 * (DOM clobbering, docs/security.md §5c), `data-payload-*` is stripped
 * (rich text must not add bindings), and other `data-*` pass only when
 * listed in `allowedDataAttributes`.
 */
export type SanitizerPolicyMode = 'compat' | 'strict';

export interface SanitizeOptions {
  /** Overrides the module default set by `setSanitizerPolicy()`. */
  readonly policy?: SanitizerPolicyMode;
  /** `data-*` attributes (full names) that pass under `'strict'`. */
  readonly allowedDataAttributes?: readonly string[];
  /**
   * Keep `input`, `button`, `textarea`, `select`, `option` and `label`
   * instead of dropping them. Only for markup the page author wrote — the
   * structural item templates — never for CMS content: every interpolated
   * value is escaped before the sanitizer runs, so these tags can come only
   * from the template. `form` stays dropped, and so do event handlers,
   * `style` and unsafe URLs.
   */
  readonly allowFormControls?: boolean;
  /** Extra tags to allow beyond the built-in list. Lower-case, untrimmed. */
  readonly additionalAllowedTags?: readonly string[];
  /** Extra per-tag attributes to allow. Tag and attribute names must be lower-case. */
  readonly additionalAllowedAttributes?: Readonly<Record<string, readonly string[]>>;
}

interface ResolvedPolicy {
  readonly allowedTags: ReadonlySet<string>;
  readonly allowFormControls: boolean;
  readonly mode: SanitizerPolicyMode;
  readonly allowedData: ReadonlySet<string>;
  readonly attrByTag: ReadonlyMap<string, ReadonlySet<string>>;
}

let defaultMode: SanitizerPolicyMode = 'compat';

/** Set the policy every `sanitizeHtml()` call without an explicit `policy` uses. The runtime sets it from `sanitizerPolicy`. */
export function setSanitizerPolicy(mode: SanitizerPolicyMode): void {
  defaultMode = mode;
}

function resolvePolicy(options: SanitizeOptions | undefined): ResolvedPolicy {
  if (!options) {
    const attrMap = new Map<string, ReadonlySet<string>>();
    for (const [tag, attrs] of Object.entries(ATTR_BY_TAG)) attrMap.set(tag, attrs);
    return {
      allowedTags: ALLOWED_TAGS,
      attrByTag: attrMap,
      allowFormControls: false,
      mode: defaultMode,
      allowedData: new Set(),
    };
  }
  const allowed = new Set(ALLOWED_TAGS);
  for (const tag of options.additionalAllowedTags ?? []) allowed.add(tag);
  if (options.allowFormControls === true) for (const tag of FORM_CONTROLS) allowed.add(tag);
  const attrMap = new Map<string, ReadonlySet<string>>();
  for (const [tag, attrs] of Object.entries(ATTR_BY_TAG)) attrMap.set(tag, attrs);
  for (const [tag, attrs] of Object.entries(options.additionalAllowedAttributes ?? {})) {
    const existing = attrMap.get(tag);
    const merged = new Set(existing ?? []);
    for (const attr of attrs) merged.add(attr);
    attrMap.set(tag, merged);
  }
  return {
    allowedTags: allowed,
    attrByTag: attrMap,
    allowFormControls: options.allowFormControls === true,
    mode: options.policy ?? defaultMode,
    allowedData: new Set((options.allowedDataAttributes ?? []).map((name) => name.toLowerCase())),
  };
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
      'sanitizeHtml needs a DOM; provide one with setSanitizerDocument() during SSR.',
    );
  }
  if (html === '') return '';

  const policy = resolvePolicy(options);
  const template = doc.createElement('template');
  // The sanitizer's own parse is a sink too: under Trusted Types it needs the policy.
  template.innerHTML = trustedHtml(html);
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
    if (child.nodeType === ELEMENT_NODE) {
      sanitizeElement(child as Element, policy);
    } else if (child.nodeType === COMMENT_NODE) {
      child.remove();
    }
  }
}

function sanitizeElement(element: Element, policy: ResolvedPolicy): void {
  const tag = element.tagName.toLowerCase();

  if (REMOVE_COMPLETELY.has(tag) && !(policy.allowFormControls && FORM_CONTROLS.has(tag))) {
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
    if (policy.mode === 'strict') {
      // DOM clobbering and binding injection (docs/security.md §5c): no `id`,
      // no `name`, no `data-payload-*`, other `data-*` only by explicit list.
      if (name === 'id' || name === 'name' || name.startsWith(BINDING_DATA_PREFIX)) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name.startsWith(ATTR_DATA_PREFIX)) {
        if (!policy.allowedData.has(name)) element.removeAttribute(attr.name);
        continue;
      }
      if (ATTR_GLOBAL.has(name) || name.startsWith(ATTR_ARIA_PREFIX)) continue;
    } else if (
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
    // `trimmed` is non-empty. Only the URL prefix before the first descriptor
    // separator is needed; slicing avoids manufacturing an optional array item.
    const descriptorStart = trimmed.search(/\s/);
    const url = descriptorStart === -1 ? trimmed : trimmed.slice(0, descriptorStart);
    if (!isSafeUrl(url)) return false;
  }
  return true;
}

function hardenAnchor(anchor: Element): void {
  const href = anchor.getAttribute('href');
  if (href === null || !isExternalHttpUrl(href)) return;
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
