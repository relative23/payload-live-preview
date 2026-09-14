/**
 * Auto-binding (ADR 0014). On the connection's first message the document and
 * the DOM are two views of the same state, so a scalar field's value can be
 * looked for in the page: where it stands as the whole content of exactly one
 * element — its only text node, or one attribute the writer may set — that
 * element is bound to the field as if `data-payload-field` had been written
 * there. No match, several, a partial one, one split across nodes: nothing,
 * and the field stays unbound, which since Z3 escalates instead of degrading.
 *
 * Two jobs, two exports. `findUniqueBindings` is the search, the exclusions and
 * the candidate rule, and reads the DOM only. `adoptUniqueBindings` writes the
 * winners onto their elements as the attributes a template would have carried,
 * plus `data-payload-guessed` holding the value that matched, and registers
 * them with the cache. Stamping is what lets a cache rebuild find a guess again
 * the way it finds any binding, and what lets `inspect()` and the overlay tell
 * a guess from a declaration.
 */

import { isWritableAttribute } from './attribute-binding';
import { isBindingInScope } from './binding-owner';
import {
  ALT_ATTRIBUTE,
  FIELD_ATTRIBUTE,
  GUESSED_ATTRIBUTE,
  HREF_ATTRIBUTE,
  TARGET_ATTRIBUTE_ATTRIBUTE,
  TYPE_ATTRIBUTE,
  resolveBindingOwner,
} from './cache';
import { isIslandBoundary } from './islands';
import type { RuntimeDeps, RuntimeState } from './runtime-state';
import { stripLocaleSuffix, SYSTEM_FIELD_NAMES, type OwnerScope } from './unbound-fields';

/** `'unique'` searches once, on the first message; `'off'` (the default) never. */
export type AutoBindMode = 'off' | 'unique';

/** An author's no: the element and everything under it is never guessed into. */
export const NO_BIND_ATTRIBUTE = 'data-payload-no-bind';
/** The morph's boundary (`src/core/morph.ts`) is this search's boundary too: a subtree the site scripts itself. */
const OWNED_ATTRIBUTE = 'data-payload-owned';

/**
 * Below this many characters a value is not looked for at all. Measured, not
 * chosen: on the trap corpus (`tests/fixtures/auto-bind-traps`) 13 is the
 * shortest floor at which no trap binds — at 12 the byline `Ada Lovelace`,
 * printed by a related post and never by the template, is a unique match in
 * the wrong place. The shortest value the shipped fixtures bind that a unique
 * match finds is `Visit Payload`, 13. So the floor separates the corpus with
 * no margin either way; what it is for are the short tokens ADR 0014 names,
 * and a phrase that occurs exactly once and in the wrong place is kept out by
 * nothing but its rarity.
 */
export const AUTO_BIND_MIN_LENGTH = 13;

const BOOLEAN_WORDS: ReadonlySet<string> = new Set(['true', 'false', 'yes', 'no', 'on', 'off']);
/** Digits with the separators a date, a time, a price or a phone number carry. */
const NUMERIC = /^[\d\s.,:+/-]+$/u;
/** A single lower-case token: an enum value, a slug, a code. */
const ENUM_TOKEN = /^[a-z][a-z0-9_-]*$/u;
/** `de`, `de-AT`, `zh_Hant`, `sr-Latn-RS`. */
const LOCALE_CODE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/u;

/** Elements whose text is code, metadata or a form value, not content. */
const SKIPPED_TAGS: ReadonlySet<string> = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'TITLE',
  'NOSCRIPT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'INPUT',
  'IFRAME',
]);
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export interface AutoBindCandidate {
  readonly element: Element;
  readonly fieldName: string;
  /** The value that matched: the text, or the attribute's value. */
  readonly matched: string;
  /** The attribute whose whole value matched; absent for a text match. */
  readonly attribute?: string;
  /** The `data-payload-*` attributes a template would have written for this binding. */
  readonly stamps: Readonly<Record<string, string>>;
}

/** A value's owner: the field, and whether it is an upload (matched by its `url` against an `<img>`). */
export interface Claim {
  readonly field: string;
  readonly media: boolean;
}

/**
 * What the baseline search adopted, kept for the server re-render a route
 * refresh morphs the page toward: that markup carries no stamp, so the guesses
 * are looked for again there — these fields, by these values — and nothing
 * else is. ADR 0014 §1 still holds for everything the baseline did not find.
 */
export interface KeptGuesses {
  /** The fields the guesses bound, a folded second field (`data-payload-href`, `data-payload-alt`) included. */
  readonly fields: ReadonlySet<string>;
  /** The texts they were found by, each claiming its field. */
  readonly values: ReadonlyMap<string, Claim>;
}

/** Whether a scalar is worth looking for: the short and shapeless ones match by accident. */
export function isBindableValue(value: unknown, minLength = AUTO_BIND_MIN_LENGTH): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < minLength) return false;
  if (NUMERIC.test(text) || BOOLEAN_WORDS.has(text.toLowerCase())) return false;
  return !ENUM_TOKEN.test(text) && !LOCALE_CODE.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The values to look for, keyed by the exact text a match must equal. A value
 * two fields share maps to `null`: the element would be unique, the field not.
 * Groups are opened one level under the dotted name a binding would carry; an
 * upload is looked for by its `url`; a document with an `id` and no `url` is
 * another document, and its scalars are not this one's.
 */
export function bindableValues(
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  minLength = AUTO_BIND_MIN_LENGTH,
): Map<string, Claim | null> {
  const values = new Map<string, Claim | null>();
  const claim = (text: string, field: string, media: boolean): void => {
    values.set(text, values.has(text) ? null : { field, media });
  };
  for (const [rawName, value] of Object.entries(fields)) {
    if (SYSTEM_FIELD_NAMES.has(rawName)) continue;
    const name = stripLocaleSuffix(rawName, locale);
    if (isBindableValue(value, minLength)) {
      claim(value.trim(), name, false);
    } else if (isRecord(value)) {
      if (typeof value['url'] === 'string') {
        claim(value['url'], name, true);
      } else if (!('id' in value) && !('_id' in value)) {
        for (const [child, childValue] of Object.entries(value)) {
          if (SYSTEM_FIELD_NAMES.has(child) || !isBindableValue(childValue, minLength)) continue;
          claim(childValue.trim(), `${name}.${child}`, false);
        }
      }
    }
  }
  return values;
}

/** Where the search stops: nothing at or under this element may be claimed. */
function isBoundary(element: Element): boolean {
  if (element.namespaceURI !== HTML_NAMESPACE || SKIPPED_TAGS.has(element.tagName)) return true;
  if (
    element.hasAttribute(FIELD_ATTRIBUTE) ||
    element.hasAttribute(NO_BIND_ATTRIBUTE) ||
    element.hasAttribute(OWNED_ATTRIBUTE) ||
    isIslandBoundary(element)
  ) {
    return true;
  }
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

/**
 * The element's whole text, when it is exactly one text node — comments and
 * whitespace-only nodes aside — and no element. A second text node is a value
 * split across nodes; an element child is markup a text write would destroy.
 */
function soleText(element: Element): string | undefined {
  let text: string | undefined;
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) return undefined;
    if (child.nodeType !== 3) continue;
    const data = (child as Text).data.trim();
    if (data.length === 0) continue;
    if (text !== undefined) return undefined;
    text = data;
  }
  return text;
}

/** No second rule beyond the writer's own; `value` is the visitor's, and `data-payload-*` is ours. */
function isCandidateAttribute(name: string): boolean {
  return isWritableAttribute(name) && !name.startsWith('data-payload-') && name !== 'value';
}

interface ElementHits {
  /** The field whose value is the element's whole text. */
  text?: string;
  /** Attribute name → the field whose value it carries. */
  readonly attributes: Map<string, Claim>;
}

interface Search {
  readonly values: ReadonlyMap<string, Claim | null>;
  readonly byElement: Map<Element, ElementHits>;
  /** Every element a field was found on; a field with more than one is ambiguous. */
  readonly byField: Map<string, Set<Element>>;
}

function record(search: Search, element: Element, claim: Claim): ElementHits {
  let hits = search.byElement.get(element);
  if (hits === undefined) {
    hits = { attributes: new Map() };
    search.byElement.set(element, hits);
  }
  let elements = search.byField.get(claim.field);
  if (elements === undefined) {
    elements = new Set();
    search.byField.set(claim.field, elements);
  }
  elements.add(element);
  return hits;
}

/**
 * One pass, depth first, in document order; the element under a boundary is
 * never looked at. Sibling pointers rather than `children` and `attributes`:
 * the live collections cost twenty times the walk in jsdom, where the
 * interaction gate measures this, and nothing in a browser.
 */
function walk(element: Element, search: Search): void {
  for (let child = element.firstElementChild; child !== null; child = child.nextElementSibling) {
    if (isBoundary(child)) continue;
    const text = soleText(child);
    const textClaim = text === undefined ? undefined : search.values.get(text);
    if (textClaim != null && !textClaim.media) {
      record(search, child, textClaim).text = textClaim.field;
    }
    for (const name of child.getAttributeNames()) {
      if (!isCandidateAttribute(name)) continue;
      const claim = search.values.get(child.getAttribute(name) ?? '');
      if (claim == null) continue;
      // An upload is matched by its file, and an `<img>` is the one element that renders one.
      if (claim.media && (child.tagName !== 'IMG' || name !== 'src')) continue;
      record(search, child, claim).attributes.set(name, claim);
    }
    walk(child, search);
  }
}

/**
 * What a template would have written for this element. One binding per
 * element: the text wins, and the two idioms a template has for a second
 * field on the same element — `data-payload-href` on a link, `data-payload-alt`
 * on an image — are used when the second field matched that attribute.
 */
function shape(
  element: Element,
  text: string | undefined,
  attributes: ReadonlyMap<string, string>,
): AutoBindCandidate | undefined {
  const tag = element.tagName;
  if (text !== undefined) {
    const stamps: Record<string, string> = { [FIELD_ATTRIBUTE]: text };
    if (tag === 'A') {
      const href = attributes.get('href');
      // The url renderer derives the href from the text; a guess that never
      // matched the href must not clear it, so the text renderer is named.
      if (href === undefined) stamps[TYPE_ATTRIBUTE] = 'text';
      else if (href !== text) stamps[HREF_ATTRIBUTE] = href;
    }
    return { element, fieldName: text, matched: soleText(element) ?? '', stamps };
  }
  if (tag === 'IMG') {
    const src = attributes.get('src');
    if (src !== undefined) {
      const alt = attributes.get('alt');
      return {
        element,
        fieldName: src,
        matched: element.getAttribute('src') ?? '',
        attribute: 'src',
        stamps: {
          [FIELD_ATTRIBUTE]: src,
          ...(alt !== undefined && alt !== src ? { [ALT_ATTRIBUTE]: alt } : {}),
        },
      };
    }
  }
  // A link whose text did not match keeps its text: only the attribute is written.
  const first = attributes.entries().next();
  if (first.done) return undefined;
  const [name, field] = first.value;
  return {
    element,
    fieldName: field,
    matched: element.getAttribute(name) ?? '',
    attribute: name,
    stamps: { [FIELD_ATTRIBUTE]: field, [TARGET_ATTRIBUTE_ATTRIBUTE]: name },
  };
}

/**
 * The bindings the page allows, in document order: for every field found on
 * exactly one element, that element with the attributes a template would have
 * given it. `root` is searched as a whole; the caller decides that a document's
 * root is its body.
 */
export function findUniqueBindings(
  root: Element,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  minLength = AUTO_BIND_MIN_LENGTH,
): AutoBindCandidate[] {
  return searchUnique(root, bindableValues(fields, locale, minLength));
}

/** The search proper, over a value table already decided on. */
function searchUnique(
  root: Element,
  values: ReadonlyMap<string, Claim | null>,
): AutoBindCandidate[] {
  const search: Search = { values, byElement: new Map(), byField: new Map() };
  if (values.size > 0 && !isBoundary(root)) walk(root, search);
  const unique = (field: string): boolean => search.byField.get(field)?.size === 1;
  const candidates: AutoBindCandidate[] = [];
  for (const [element, hits] of search.byElement) {
    const text = hits.text !== undefined && unique(hits.text) ? hits.text : undefined;
    const attributes = new Map<string, string>();
    for (const [name, claim] of hits.attributes) {
      if (unique(claim.field)) attributes.set(name, claim.field);
    }
    const candidate = shape(element, text, attributes);
    if (candidate !== undefined) candidates.push(candidate);
  }
  return candidates;
}

/** A document's root is its body: a binding in `<head>` needs the attribute and the route strategy. */
function searchRoot(root: Document | Element): Element | null {
  return root.nodeType === 9 ? (root as Document).body : (root as Element);
}

/**
 * Run the search once and make its winners bindings. Returns how many. The
 * stamps land on the elements first, so the cache resolves each guess exactly
 * as it resolves a declared binding — and so the mutation observer's rebuild,
 * which the stamps themselves trigger, finds them again.
 */
export function adoptUniqueBindings(
  deps: RuntimeDeps,
  state: RuntimeState,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  ownerKeys: OwnerScope,
): number {
  const started = performance.now();
  const root = searchRoot(deps.root);
  const values = bindableValues(fields, locale);
  const adopted =
    root === null ? [] : adopt(deps, searchUnique(root, values), ownerKeys, 'on the first message');
  state.autoBindGuesses = keep(values, adopted);
  state.autoBindSearchMs = performance.now() - started;
  return adopted.length;
}

/**
 * After a server render — a route refresh, or a fragment in its boundary: the
 * server's markup carries no stamp, so the guesses the baseline made are gone
 * from what it rendered. Look for them again, by the value
 * each was found by and by the field's value in this revision — the server
 * may have rendered either, the document as it was saved or a draft it
 * autosaved since. A field found by both, on two elements, is ambiguous and
 * stays unbound. Nothing the baseline did not bind is looked for: a second
 * baseline would be a second chance at a wrong match, and the first one is
 * the only moment the page is known to show the document (ADR 0014 §1).
 */
export function restoreUniqueBindings(
  deps: RuntimeDeps,
  state: RuntimeState,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  ownerKeys: OwnerScope,
): number {
  const kept = state.autoBindGuesses;
  const root = searchRoot(deps.root);
  if (kept === null || kept.fields.size === 0 || root === null) return 0;
  const values = new Map<string, Claim | null>(kept.values);
  for (const [text, claim] of bindableValues(fields, locale)) {
    if (claim === null || !kept.fields.has(claim.field)) continue;
    const known = values.get(text);
    if (known === undefined) values.set(text, claim);
    else if (known?.field !== claim.field) values.set(text, null);
  }
  return adopt(deps, searchUnique(root, values), ownerKeys, 'after a server render').length;
}

/** Stamp the candidates, register them, say so; returns the ones that became bindings. */
function adopt(
  deps: RuntimeDeps,
  candidates: readonly AutoBindCandidate[],
  ownerKeys: OwnerScope,
  when: string,
): AutoBindCandidate[] {
  const adopted: AutoBindCandidate[] = [];
  for (const candidate of candidates) {
    const { element } = candidate;
    if (element.hasAttribute(FIELD_ATTRIBUTE)) continue;
    // Under owner scoping a guess outside the message's document would never
    // be written to; better to leave it unbound than to bind it to nothing.
    if (ownerKeys !== false && !isBindingInScope(resolveBindingOwner(element), ownerKeys)) continue;
    for (const [name, value] of Object.entries(candidate.stamps)) element.setAttribute(name, value);
    element.setAttribute(GUESSED_ATTRIBUTE, candidate.matched);
    if (deps.cache.add(element) === undefined) {
      // The cache's own filter refused it; a stamp that is not a binding must not stay.
      for (const name of Object.keys(candidate.stamps)) element.removeAttribute(name);
      element.removeAttribute(GUESSED_ATTRIBUTE);
      continue;
    }
    deps.observers.observeElement(element);
    deps.log(
      'autoBind',
      candidate.fieldName,
      '→',
      `<${element.tagName.toLowerCase()}>`,
      candidate.attribute ?? 'text',
      JSON.stringify(candidate.matched),
      when,
    );
    adopted.push(candidate);
  }
  return adopted;
}

/** The fields the adopted guesses bound, and the values that found them. */
function keep(
  values: ReadonlyMap<string, Claim | null>,
  adopted: readonly AutoBindCandidate[],
): KeptGuesses {
  const fields = new Set<string>();
  for (const { fieldName, stamps } of adopted) {
    fields.add(fieldName);
    for (const name of [HREF_ATTRIBUTE, ALT_ATTRIBUTE]) {
      const folded = stamps[name];
      if (folded !== undefined) fields.add(folded);
    }
  }
  const kept = new Map<string, Claim>();
  for (const [text, claim] of values) {
    if (claim !== null && fields.has(claim.field)) kept.set(text, claim);
  }
  return { fields, values: kept };
}
