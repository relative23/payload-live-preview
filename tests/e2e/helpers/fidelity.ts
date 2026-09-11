import { JSDOM } from 'jsdom';

/**
 * The comparison behind the fidelity oracle: one patched region out of a live
 * page, one region the server rendered for the same document state, and every
 * way the two differ.
 *
 * Payload's own claim rests on a freshly rendered tree always being correct, so
 * a patched tree is only as good as its distance from one. This module measures
 * that distance: it drops what carries no meaning — comment markers,
 * `data-payload-*`, attribute and class order, indentation — and reports what
 * survives as a difference that names the field, the element and both values.
 * It is a separate module from the spec because the normalisation is the part
 * that has to be argued about, and it must be readable without a browser.
 */

export type DifferenceKind = 'attribute' | 'extra' | 'missing' | 'text';

export interface Difference {
  readonly kind: DifferenceKind;
  /** `div[hero-body] > p` — enough to find the element, stable between runs. */
  readonly path: string;
  /** The nearest `data-payload-field` at or above the element, or `-`. */
  readonly field: string;
  /** `kind|path`, the key a recorded exception is matched by. */
  readonly signature: string;
  readonly server: string;
  readonly live: string;
}

/** How much of an element's markup a report prints before it is cut. */
const EXCERPT = 120;

/**
 * Annotation, not content: the runtime may add, move or drop these while
 * patching, and none of them is visible to a reader of the page.
 */
function isAnnotation(name: string): boolean {
  return name.startsWith('data-payload-');
}

function parse(html: string): DocumentFragment {
  return JSDOM.fragment(html);
}

/** Whitespace between elements is the formatter's, never the document's. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ');
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function excerpt(node: Node): string {
  const markup = isElement(node) ? node.outerHTML : (node.textContent ?? '');
  const collapsed = normalizeText(markup).trim();
  return collapsed.length > EXCERPT ? `${collapsed.slice(0, EXCERPT)}…` : collapsed;
}

/** Comments are React's and Astro's bookkeeping; nothing renders them. */
function comparableChildren(node: Node): readonly Node[] {
  return [...node.childNodes].filter((child) => isElement(child) || isText(child));
}

function attributeOf(node: Node, name: string): string | undefined {
  return isElement(node) ? (node.getAttribute(name) ?? undefined) : undefined;
}

/** A short, human name for one node; `data-testid` wins because a fixture chose it. */
function describe(node: Node): string {
  if (isText(node)) return '#text';
  if (!isElement(node)) return '#node';
  const tag = node.tagName.toLowerCase();
  const testid = node.getAttribute('data-testid');
  if (testid !== null) return `${tag}[${testid}]`;
  const field = node.getAttribute('data-payload-field');
  return field === null ? tag : `${tag}[field=${field}]`;
}

/**
 * What makes two nodes the same node in two renderings. Alignment by this key
 * rather than by position keeps one inserted section from turning every later
 * sibling into a difference of its own.
 */
function alignmentKey(node: Node): string {
  if (!isElement(node)) return '#text';
  const parts = [node.tagName.toLowerCase()];
  for (const name of ['id', 'data-testid', 'data-payload-field', 'data-payload-key']) {
    const value = node.getAttribute(name);
    if (value !== null) parts.push(`${name}=${value}`);
  }
  return parts.join('|');
}

interface Pairing {
  readonly server: Node | undefined;
  readonly live: Node | undefined;
}

/**
 * Longest common subsequence over the alignment keys. The lists are a section's
 * children, so they are short and the quadratic table is the simplest thing
 * that reports one insertion as one difference.
 */
function align(server: readonly Node[], live: readonly Node[]): readonly Pairing[] {
  const table: number[][] = Array.from({ length: server.length + 1 }, () =>
    Array.from({ length: live.length + 1 }, () => 0),
  );
  for (let s = server.length - 1; s >= 0; s -= 1) {
    for (let l = live.length - 1; l >= 0; l -= 1) {
      table[s]![l] =
        alignmentKey(server[s]!) === alignmentKey(live[l]!)
          ? table[s + 1]![l + 1]! + 1
          : Math.max(table[s + 1]![l]!, table[s]![l + 1]!);
    }
  }

  const pairs: Pairing[] = [];
  let s = 0;
  let l = 0;
  while (s < server.length && l < live.length) {
    if (alignmentKey(server[s]!) === alignmentKey(live[l]!)) {
      pairs.push({ server: server[s], live: live[l] });
      s += 1;
      l += 1;
    } else if (table[s + 1]![l]! >= table[s]![l + 1]!) {
      pairs.push({ server: server[s], live: undefined });
      s += 1;
    } else {
      pairs.push({ server: undefined, live: live[l] });
      l += 1;
    }
  }
  for (; s < server.length; s += 1) pairs.push({ server: server[s], live: undefined });
  for (; l < live.length; l += 1) pairs.push({ server: undefined, live: live[l] });
  return pairs;
}

interface Walk {
  readonly path: string;
  readonly field: string;
  /** Fields the message changed: the server's copy is older there. */
  readonly changed: ReadonlySet<string>;
  readonly out: Difference[];
}

function record(
  walk: Walk,
  kind: DifferenceKind,
  path: string,
  server: string,
  live: string,
): void {
  walk.out.push({ kind, path, field: walk.field, signature: `${kind}|${path}`, server, live });
}

/** `class="a b"` and `class="b a"` are the same page; attribute order likewise. */
function attributeValue(node: Element, name: string): string | undefined {
  const value = node.getAttribute(name);
  if (value === null) return undefined;
  if (name === 'class') return value.trim().split(/\s+/u).sort().join(' ');
  return normalizeText(value).trim();
}

/**
 * Astro's scoped-style marker carries a per-file hash. The difference in it is
 * real — a re-rendered element that lost the marker lost its styling — but a
 * signature that pins the hash makes the ledger stale the day a file moves.
 */
function signatureName(name: string): string {
  return name.startsWith('data-astro-cid-') ? 'data-astro-cid' : name;
}

function compareAttributes(walk: Walk, path: string, server: Element, live: Element): void {
  const names = new Set(
    [...server.getAttributeNames(), ...live.getAttributeNames()].filter(
      (name) => !isAnnotation(name),
    ),
  );
  for (const name of [...names].sort()) {
    const expected = attributeValue(server, name);
    const actual = attributeValue(live, name);
    if (expected === actual) continue;
    record(
      walk,
      'attribute',
      `${path} @${signatureName(name)}`,
      expected ?? '(absent)',
      actual ?? '(absent)',
    );
  }
}

function compareNodes(walk: Walk, pairing: Pairing, index: number): void {
  const { server, live } = pairing;
  const node = server ?? live;
  if (node === undefined) return;
  const path = walk.path === '' ? describe(node) : `${walk.path} > ${describe(node)}`;

  // A field the message changed is the one place the server is legitimately
  // behind: it renders the saved document, and the edit is not saved yet.
  const boundField = attributeOf(node, 'data-payload-field');
  if (boundField !== undefined && walk.changed.has(boundField)) return;
  const field = boundField ?? walk.field;

  const inner: Walk = { ...walk, path, field };
  if (server === undefined) {
    record(inner, 'extra', path, '(absent)', excerpt(live!));
    return;
  }
  if (live === undefined) {
    record(inner, 'missing', path, excerpt(server), '(absent)');
    return;
  }

  if (isText(server) && isText(live)) {
    const expected = normalizeText(server.data);
    const actual = normalizeText(live.data);
    // Position disambiguates the many `#text` children of one element.
    if (expected !== actual) {
      record(inner, 'text', `${path}:${index + 1}`, expected.trim(), actual.trim());
    }
    return;
  }
  if (!isElement(server) || !isElement(live)) return;

  compareAttributes(inner, path, server, live);
  const pairs = align(comparableChildren(server), comparableChildren(live));
  pairs.forEach((pair, childIndex) => {
    compareNodes(inner, pair, childIndex);
  });
}

export interface FidelityOptions {
  /**
   * Field names the update message changed. Their bound elements are skipped:
   * the server rendered the saved document, so only the untouched parts of the
   * page have a truth to be measured against.
   */
  readonly changedFields?: readonly string[];
}

/**
 * Every way the patched markup differs from what the server rendered for the
 * same state. An empty result is the fidelity claim, measured.
 */
export function compareFidelity(
  live: string,
  server: string,
  options: FidelityOptions = {},
): readonly Difference[] {
  const walk: Walk = {
    path: '',
    field: '-',
    changed: new Set(options.changedFields ?? []),
    out: [],
  };
  const pairs = align(comparableChildren(parse(server)), comparableChildren(parse(live)));
  pairs.forEach((pair, index) => {
    compareNodes(walk, pair, index);
  });
  return walk.out;
}

/** One region out of a whole server response, addressed the way the live one is. */
export function regionOf(html: string, selector: string): string {
  const found = parse(html).querySelector(selector);
  if (found === null) throw new Error(`the server response has no ${selector}`);
  return found.outerHTML;
}

/** The signatures a run found, deduplicated: three identical list items are one finding. */
export function signaturesOf(differences: readonly Difference[]): readonly string[] {
  return [...new Set(differences.map((difference) => difference.signature))].sort();
}

/** The failure message: field, element and difference, one line each. */
export function reportDifferences(differences: readonly Difference[]): string {
  if (differences.length === 0) return 'no differences';
  return differences
    .map(
      (difference) =>
        `${difference.signature}  field=${difference.field}\n` +
        `    server: ${difference.server}\n` +
        `    live:   ${difference.live}`,
    )
    .join('\n');
}
