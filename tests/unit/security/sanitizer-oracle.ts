import { expect } from 'vitest';
import type { SanitizeOptions } from '@security/sanitizer';
import { isSafeUrl } from '@security/url-validator';

/**
 * The oracle the corpus and the fuzz share: a deny-list of what a browser
 * would run or navigate on, written without reading the sanitizer's
 * allow-lists so that a mistake in those lists cannot also be a mistake here.
 */

export interface CorpusPolicy {
  readonly name: 'strict' | 'compat' | 'template';
  readonly options: SanitizeOptions | undefined;
}

/** Elements a browser executes, loads or navigates through. */
const ACTIVE_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'keygen',
  'isindex',
  'svg',
  'math',
  'template',
  'noscript',
  'noembed',
  'xmp',
  'plaintext',
  'listing',
  'title',
  'map',
  'area',
  'slot',
]);

/** Attributes that carry code, CSS, a navigation target or a load. */
const ACTIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'style',
  'srcdoc',
  'action',
  'formaction',
  'background',
  'lowsrc',
  'dynsrc',
  'ping',
  'usemap',
  'is',
  'xmlns',
  'longdesc',
  'http-equiv',
  'content',
  'codebase',
  'code',
  'data',
  'archive',
  'manifest',
  'profile',
]);

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'cite',
  'poster',
  'xlink:href',
]);

function parse(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Fails on the first script-capable construct in `output`. */
export function assertNoActiveContent(output: string, policy: CorpusPolicy, label: string): void {
  for (const element of parse(output).querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();
    expect(ACTIVE_TAGS.has(tag), `${label}: <${tag}> survived under ${policy.name}`).toBe(false);
    expect(tag.includes(':'), `${label}: namespaced <${tag}> under ${policy.name}`).toBe(false);
    expect(element.namespaceURI, `${label}: <${tag}> left the HTML namespace`).toBe(
      'http://www.w3.org/1999/xhtml',
    );
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const where = `${label}: ${tag}[${name}="${attribute.value}"] under ${policy.name}`;
      expect(name.startsWith('on'), where).toBe(false);
      // `is` cannot be removed from a parsed element (its value is immutable
      // and re-serialised); emptied, it names nothing.
      if (name === 'is') expect(attribute.value, where).toBe('');
      else expect(ACTIVE_ATTRIBUTES.has(name), where).toBe(false);
      expect(name.includes(':'), where).toBe(false);
      if (URL_ATTRIBUTES.has(name)) expect(isSafeUrl(attribute.value), where).toBe(true);
      if (name === 'srcset') {
        for (const candidate of attribute.value.split(',')) {
          const url = candidate.trim().split(/\s+/, 1)[0];
          if (url !== undefined && url.length > 0) expect(isSafeUrl(url), where).toBe(true);
        }
      }
      if (policy.name === 'strict') {
        expect(name === 'id' || name === 'name' || name.startsWith('data-payload-'), where).toBe(
          false,
        );
      }
    }
  }
}

/** Every (tag, attribute) pair present in `html`, plus a bare `tag` entry per element. */
export function keptPairs(html: string): Set<string> {
  const pairs = new Set<string>();
  for (const element of parse(html).querySelectorAll('*')) addPairs(pairs, element);
  return pairs;
}

/** The element's tag and each of its `tag[attribute]` pairs. */
function addPairs(pairs: Set<string>, element: Element): void {
  const tag = element.tagName.toLowerCase();
  pairs.add(tag);
  for (const attribute of element.attributes) {
    pairs.add(`${tag}[${attribute.name.toLowerCase()}]`);
  }
}

/** The pairs we add on purpose: `noopener noreferrer` and `_blank` on an external link. */
const HARDENING: ReadonlySet<string> = new Set(['a[rel]', 'a[target]']);

/**
 * DOMPurify's `SAFE_FOR_XML` guard drops an attribute whose value could close
 * a comment or a CDATA section, or one of the raw-text elements, if the
 * markup were ever serialised into an XML context (its pattern, copied). Ours keeps the attribute: a quoted
 * value is a value to the HTML parser, the runtime and the server renderer
 * write HTML only, and the fixed-point check pins the re-parse. Recorded in
 * ADR 0016 as a difference, not a finding.
 */
const XML_BREAKOUT =
  /((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i;

/**
 * DOMPurify also refuses any attribute, whatever its name, whose value does
 * not look like an allowed URI, unless the name is on its short "never a
 * URI" list; ours checks values only on the attributes a browser navigates or
 * loads from (`href`, `src`, `srcset`, `cite`, `poster`). A `javascript:`
 * spelled into `type` or `rows` is inert. Its patterns, copied, so the
 * difference is classified exactly.
 */
const PURIFY_ALLOWED_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
/* eslint-disable no-control-regex -- DOMPurify's ATTR_WHITESPACE, copied verbatim */
const PURIFY_ATTR_WHITESPACE = new RegExp(
  '[\\x00-\\x20\\xA0\\u1680\\u180E\\u2000-\\u2029\\u205F\\u3000]',
  'g',
);
/* eslint-enable no-control-regex */
const PURIFY_URI_SAFE: ReadonlySet<string> = new Set([
  'alt',
  'class',
  'for',
  'id',
  'label',
  'name',
  'pattern',
  'placeholder',
  'role',
  'summary',
  'title',
  'value',
  'style',
  'xmlns',
]);
const OUR_URL_SINKS: ReadonlySet<string> = new Set(['href', 'src', 'srcset', 'cite', 'poster']);

function purifyBlanketUriDrops(value: string, name: string): boolean {
  if (PURIFY_URI_SAFE.has(name) || OUR_URL_SINKS.has(name)) return false;
  return !PURIFY_ALLOWED_URI.test(value.replace(PURIFY_ATTR_WHITESPACE, ''));
}

/** Pairs whose every value in `html` is one the XML guard or the blanket URI rule would drop. */
function xmlGuardedPairs(html: string): Set<string> {
  const guarded = new Map<string, boolean>();
  for (const element of parse(html).querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const pair = `${tag}[${name}]`;
      const hit =
        XML_BREAKOUT.test(attribute.value) || purifyBlanketUriDrops(attribute.value, name);
      guarded.set(pair, (guarded.get(pair) ?? true) && hit);
    }
  }
  return new Set([...guarded].filter(([, all]) => all).map(([pair]) => pair));
}

/**
 * Pairs we keep that DOMPurify drops, minus the hardening we add, the
 * author's own custom elements (DOMPurify refuses them by default; a template
 * may name them), in template mode the author's `id` and `name` (DOMPurify's
 * clobbering guard drops values that collide with a `document` or form
 * property, while a template keeps them because `form` never survives and a
 * named property never shadows one the document really has), the subtrees of
 * foreign-named elements and the XML-guarded values, both explained below.
 */
export function missingFromPurify(
  oursHtml: string,
  theirsHtml: string,
  options: SanitizeOptions | undefined,
  input: string,
  purify: Purify,
): string[] {
  const ours = keptPairs(oursHtml);
  const theirs = keptPairs(theirsHtml);
  const custom = new Set((options?.additionalAllowedTags ?? []).filter((tag) => tag.includes('-')));
  const authorNames = options?.templateMode === true;
  const foreign = foreignSubtreePairs(input, purify);
  const probed = purifyProbedPairs(input);
  const xmlGuarded = xmlGuardedPairs(oursHtml);
  const missing: string[] = [];
  for (const pair of ours) {
    if (
      theirs.has(pair) ||
      HARDENING.has(pair) ||
      foreign.has(pair) ||
      probed.has(pair) ||
      xmlGuarded.has(pair)
    ) {
      continue;
    }
    const [tag = pair, attribute] = pair.split('[', 2);
    if (custom.has(tag)) continue;
    if (authorNames && (attribute === 'id]' || attribute === 'name]')) continue;
    missing.push(pair);
  }
  return missing.sort();
}

/** What the oracle asks of DOMPurify: the one call `purifyLikeOurs` makes. */
export interface Purify {
  readonly sanitize: (node: Node, config: object) => unknown;
}

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Per DOMPurify instance: the tag names it removes from the HTML namespace together with their children. */
const WHOLESALE = new WeakMap<Purify, Map<string, boolean>>();

/**
 * Whether DOMPurify removes an HTML-namespace element of this name with its
 * children. It does so for the names of MathML and SVG elements that HTML does
 * not share (`mglyph`, `g`, `desc`, ...), as a mutation-XSS precaution against
 * the integration-point pivots. Asked of the engine rather than listed: its
 * tables move with its version.
 */
function dropsWithChildren(purify: Purify, sample: Element): boolean {
  const known = WHOLESALE.get(purify) ?? new Map<string, boolean>();
  WHOLESALE.set(purify, known);
  const tag = sample.localName;
  const cached = known.get(tag);
  if (cached !== undefined) return cached;
  const outer = document.createElement('div');
  const container = document.createElement('div');
  // A clone, not `createElement(tag)`: the parser makes names (`a<`) that DOM methods refuse.
  const element = sample.cloneNode(false) as Element;
  const child = document.createElement('b');
  element.append(child);
  container.append(element);
  outer.append(container);
  purify.sanitize(outer, { IN_PLACE: true, FORBID_CONTENTS: [] });
  const dropped = !outer.contains(child);
  known.set(tag, dropped);
  return dropped;
}

/**
 * The pairs inside an HTML-namespace element DOMPurify removes with its
 * children. Ours unwraps an unknown tag and keeps its children: the foreign
 * containers (`svg`, `math`) it removes outright, so a bare pivot in HTML is
 * inert, and the fixed point, which `sanitizeHtml` now reaches by
 * construction, covers the re-parse. A pair that sits under such an element
 * is one DOMPurify never got to judge, so it is not a finding.
 */
function foreignSubtreePairs(input: string, purify: Purify): Set<string> {
  const pairs = new Set<string>();
  for (const element of parse(input).querySelectorAll('*')) {
    if (element.namespaceURI !== XHTML_NAMESPACE) continue;
    if (!dropsWithChildren(purify, element)) continue;
    for (const inner of element.querySelectorAll('*')) addPairs(pairs, inner);
  }
  return pairs;
}

/**
 * DOMPurify's namespace-confusion probe (its rule 1, `ELEMENT_MARKUP_PROBE`,
 * copied): an element with child nodes but no element child, whose text
 * reads like markup and whose serialised content reads like markup too —
 * escaped text beside a comment, typically — is removed whole, because an
 * XML serialisation would write the text unescaped. Ours removes the comment,
 * escapes the text on serialisation and pins the fixed point; the element
 * and its pairs are not a finding.
 */
const ELEMENT_MARKUP_PROBE = /<[/\w!]/;

function purifyProbedPairs(input: string): Set<string> {
  const pairs = new Set<string>();
  for (const element of parse(input).querySelectorAll('*')) {
    if (!element.hasChildNodes() || element.firstElementChild !== null) continue;
    if (!ELEMENT_MARKUP_PROBE.test(element.textContent)) continue;
    if (!ELEMENT_MARKUP_PROBE.test(element.innerHTML)) continue;
    for (const pair of keptPairs(element.outerHTML)) pairs.add(pair);
  }
  return pairs;
}

/**
 * DOMPurify over the same parse as ours: the markup parsed in a `<template>`
 * (the sanitizer's own context: scripting on, table parts kept), its nodes
 * moved into a container without a re-parse, sanitised in place. The
 * question put to it is which elements and attributes it admits, so
 * `FORBID_CONTENTS` is emptied: by default DOMPurify drops the children of
 * some elements it removes (`mglyph`, `mtext`, `desc`, `title`, …) as a
 * mutation-XSS precaution, where ours unwraps them. Ours removes every
 * namespace-changing container outright (`svg`, `math`, `template`, the
 * raw-text elements) and pins the fixed point per input, which is the
 * property that precaution stands in for; the corpus's mXSS class checks it
 * vector by vector.
 */
export function purifyLikeOurs(purify: Purify, html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const container = document.createElement('div');
  container.append(template.content);
  // One level of wrapping: DOMPurify refuses to sanitise in place when the
  // root itself is what it would remove (markup-like text at the top level).
  const outer = document.createElement('div');
  outer.append(container);
  purify.sanitize(outer, { IN_PLACE: true, FORBID_CONTENTS: [] });
  return container.parentNode === outer ? container.innerHTML : '';
}
