/**
 * HTML sanitizer built on the host parser (`<template>`): allow-listed tags
 * and attributes, validated URLs, hardened external links, no `style`.
 * Needs a DOM; string-only sanitizers are historically brittle.
 */

import { trustedHtml } from './trusted-types';
import { isSafeUrl, isExternalHttpUrl } from './url-validator';

declare const __INLINE_BUILD__: boolean | undefined;

/** Tags kept with their content. Others are unwrapped unless in `REMOVE_COMPLETELY`. */
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

/** Tags `allowFormControls` re-admits for author templates; `form` is deliberately not one. */
const FORM_CONTROLS: ReadonlySet<string> = new Set([
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'label',
]);

/** Removed with their children: the content itself is the hazard. */
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

// Numeric nodeType constants keep an injected SSR document independent of a
// browser-global `Node` constructor.
const ELEMENT_NODE = 1;
const COMMENT_NODE = 8;

/** Thrown by `sanitizeHtml()` when no `document` is available (SSR without `setSanitizerDocument()`). */
export class SanitizerEnvironmentError extends Error {
  override readonly name = 'SanitizerEnvironmentError';
}

/**
 * `'strict'` (default) strips `id`, `name` and `data-payload-*` and passes
 * other `data-*` only via `allowedDataAttributes`; `'compat'` keeps them.
 */
export type SanitizerPolicyMode = 'compat' | 'strict';

export interface SanitizeOptions {
  /** Overrides the module default set by `setSanitizerPolicy()`. */
  readonly policy?: SanitizerPolicyMode;
  /** `data-*` attributes (full names) that pass under `'strict'`; `data-payload-*` never does. */
  readonly allowedDataAttributes?: readonly string[];
  /**
   * Keep `input`, `button`, `textarea`, `select`, `option` and `label` — only
   * for markup the page author wrote, never for CMS content. `form`,
   * handlers, `style` and unsafe URLs stay dropped.
   */
  readonly allowFormControls?: boolean;
  /** Extra tags to allow. Lower-case, untrimmed. */
  readonly additionalAllowedTags?: readonly string[];
  /**
   * Extra per-tag attributes, lower-case. Cannot re-admit handlers, `style`,
   * or — under `'strict'` — `id`, `name` and `data-payload-*`.
   */
  readonly additionalAllowedAttributes?: Readonly<Record<string, readonly string[]>>;
  /**
   * The input is a page-author item template, so `'strict'` keeps the
   * applier's reconciliation attributes (`TEMPLATE_ATTRIBUTES`) and nothing
   * else — every other `data-payload-*` is still stripped, so a template can
   * never add a binding.
   */
  readonly templateMode?: boolean;
}

/** What `templateMode` keeps under `'strict'`. */
const TEMPLATE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'name',
  'data-payload-key',
  'data-payload-nested-key',
  'data-payload-nested-template',
]);

interface ResolvedPolicy {
  readonly allowedTags: ReadonlySet<string>;
  readonly allowFormControls: boolean;
  readonly templateMode: boolean;
  readonly mode: SanitizerPolicyMode;
  readonly allowedData: ReadonlySet<string>;
  readonly attrByTag: ReadonlyMap<string, ReadonlySet<string>>;
}

let defaultMode: SanitizerPolicyMode = 'strict';

/**
 * The process-wide default for calls without an explicit `policy`. A runtime
 * instance carries its own `sanitizerPolicy` and never writes here (ADR 0002).
 */
export function setSanitizerPolicy(mode: SanitizerPolicyMode): void {
  defaultMode = mode;
}

/** `instancePolicy` sits between a per-call `options.policy` and the process default. */
function resolvePolicy(
  options: SanitizeOptions | undefined,
  instancePolicy: SanitizerPolicyMode | undefined,
): ResolvedPolicy {
  const mode = options?.policy ?? instancePolicy ?? defaultMode;
  if (!options) {
    const attrMap = new Map<string, ReadonlySet<string>>();
    for (const [tag, attrs] of Object.entries(ATTR_BY_TAG)) attrMap.set(tag, attrs);
    return {
      allowedTags: ALLOWED_TAGS,
      attrByTag: attrMap,
      allowFormControls: false,
      templateMode: false,
      mode,
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
    templateMode: options.templateMode === true,
    mode,
    allowedData: new Set((options.allowedDataAttributes ?? []).map((name) => name.toLowerCase())),
  };
}

/** The `Document` surface the sanitizer needs; jsdom, linkedom and happy-dom all provide it. */
export interface SanitizerDocument {
  createElement: (tagName: string) => {
    innerHTML: string;
    readonly content: ParentNode;
  };
}

let documentOverride: SanitizerDocument | undefined;

/** Supply a `Document` for SSR, e.g. linkedom's `parseHTML(...).document`; `null` clears it. */
export function setSanitizerDocument(doc: SanitizerDocument | null): void {
  documentOverride = doc ?? undefined;
}

/**
 * Sanitize `html`; malformed input is recovered by the parser first.
 *
 * @throws {SanitizerEnvironmentError} when no DOM is available.
 */
export function sanitizeHtml(html: string, options?: SanitizeOptions): string {
  return sanitizeHtmlWithPolicy(html, undefined, options);
}

/**
 * The runtime's entry: `policy` is one instance's, applied unless `options`
 * carry their own, so two clients on a page never share a policy through
 * this module. Not public — a direct caller has `options.policy`.
 */
export function sanitizeHtmlWithPolicy(
  html: string,
  policy: SanitizerPolicyMode | undefined,
  options?: SanitizeOptions,
): string {
  const doc = resolveDocument();
  if (!doc) throw environmentError();
  if (html === '') return '';

  const resolved = resolvePolicy(options, policy);
  const template = doc.createElement('template');
  // The sanitizer's own parse is a sink too: under Trusted Types it needs the policy.
  template.innerHTML = trustedHtml(html);
  sanitizeFragment(template.content, resolved);
  return template.innerHTML;
}

// Read the define at each branch rather than through a helper: a bundler
// folds the substituted literal in place, but will not inline a call, and the
// SSR-only class and override must not reach the browser runtime.
function environmentError(): Error {
  if (typeof __INLINE_BUILD__ !== 'undefined' && __INLINE_BUILD__) {
    return new Error('sanitizeHtml needs a DOM');
  }
  return new SanitizerEnvironmentError(
    'sanitizeHtml needs a DOM; provide one with setSanitizerDocument() during SSR.',
  );
}

function resolveDocument(): SanitizerDocument | undefined {
  if (typeof __INLINE_BUILD__ === 'undefined' || !__INLINE_BUILD__) {
    if (documentOverride) return documentOverride;
  }
  if (typeof document === 'undefined') return undefined;
  return document;
}

/** Whether a DOM is available — the global or an injected one — for callers that treat sanitizing as optional. */
export function hasSanitizerDocument(): boolean {
  return resolveDocument() !== undefined;
}

function sanitizeFragment(node: ParentNode, policy: ResolvedPolicy): void {
  // Snapshot: children are mutated during the walk.
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
    sanitizeFragment(element, policy);
    const parent = element.parentNode;
    if (parent) {
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      element.remove();
    }
    return;
  }

  sanitizeAttributes(element, tag, policy);
  if (tag === 'a') hardenAnchor(element);
  sanitizeFragment(element, policy);
}

function sanitizeAttributes(element: Element, tag: string, policy: ResolvedPolicy): void {
  const tagAttrs = policy.attrByTag.get(tag);

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || name === 'style') {
      element.removeAttribute(attr.name);
      continue;
    }
    if (policy.mode === 'strict') {
      if (policy.templateMode && TEMPLATE_ATTRIBUTES.has(name)) continue;
      // DOM clobbering and binding injection (docs/security.md §5c). Checked
      // before the allow-list so an extension cannot re-admit them.
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

/** Every `srcset` candidate must pass; partial rewriting would silently change what renders. */
function isSafeSrcset(value: string): boolean {
  for (const candidate of value.split(',')) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
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

/** The built-in allow-lists, for documentation and tests. */
export const SANITIZER_POLICY = Object.freeze({
  allowedTags: ALLOWED_TAGS,
  removeCompletely: REMOVE_COMPLETELY,
  globalAttributes: ATTR_GLOBAL,
  attributesByTag: ATTR_BY_TAG,
  urlAttributes: URL_ATTRIBUTES,
});
