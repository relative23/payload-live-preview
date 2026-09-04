/**
 * Keyed DOM morph: edits a live element toward a freshly rendered one while
 * keeping the live nodes, and with them focus, selection, scroll, playback and
 * listeners. Custom elements, islands, `contenteditable` and
 * `data-payload-owned` subtrees are boundaries the morph never enters.
 * See ADR 0008.
 */

import { ISLAND_ATTRIBUTE } from './islands';

export { ISLAND_ATTRIBUTE };
export const OWNED_ATTRIBUTE = 'data-payload-owned';

/** Attributes the CMS controls only when the template names them (ADR 0008 §3). */
const STATE_ATTRIBUTES: ReadonlySet<string> = new Set(['open', 'value', 'checked', 'selected']);

export interface MorphOptions {
  /** Attributes that key child elements for pairing, tried in order; unkeyed children pair by position. */
  readonly keyAttributes: readonly string[];
  /** Called once per parent when two children share a key; the later ones pair by position. */
  readonly onDuplicateKey?: (parent: Element, key: string) => void;
  /** Elements whose attributes are synchronised but whose children are left alone (nested structural slots). */
  readonly retainChildrenOf?: (live: Element, rendered: Element) => boolean;
}

/** Empty attribute values (boolean markers such as `data-payload-island`) are not keys. */
function keyOf(element: Element, options: MorphOptions): string | undefined {
  for (const attribute of options.keyAttributes) {
    const value = element.getAttribute(attribute);
    if (value !== null && value.length > 0) return `${attribute}=${value}`;
  }
  return undefined;
}

export function isMorphBoundary(element: Element): boolean {
  if (element.tagName.toLowerCase().includes('-')) return true;
  if (element.hasAttribute(ISLAND_ATTRIBUTE) || element.hasAttribute(OWNED_ATTRIBUTE)) return true;
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

/** Whether `live` can be edited toward `rendered` instead of being replaced by it. */
export function isMorphCompatible(live: Element, rendered: Element): boolean {
  return (
    live.tagName === rendered.tagName &&
    live.namespaceURI === rendered.namespaceURI &&
    !isMorphBoundary(live) &&
    !isMorphBoundary(rendered)
  );
}

/**
 * Morph `live` toward `rendered`. Returns `live` when it was retained, or
 * `rendered` when the two are incompatible and the caller must replace.
 * `rendered` is consumed: its children may move into `live`.
 */
export function morphElement(live: Element, rendered: Element, options: MorphOptions): Element {
  if (!isMorphCompatible(live, rendered)) return rendered;
  const focus = captureFocus(live);
  syncAttributes(live, rendered);
  if (options.retainChildrenOf?.(live, rendered) !== true) morphChildren(live, rendered, options);
  restoreFocus(focus);
  return live;
}

/** Match attributes, except that state-bearing ones change only when `rendered` carries them. */
export function syncAttributes(live: Element, rendered: Element): void {
  for (const attribute of Array.from(live.attributes)) {
    if (rendered.hasAttribute(attribute.name)) continue;
    if (STATE_ATTRIBUTES.has(attribute.name.toLowerCase())) continue;
    live.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(rendered.attributes)) {
    if (live.getAttribute(attribute.name) !== attribute.value) {
      live.setAttribute(attribute.name, attribute.value);
    }
  }
}

function morphChildren(live: Element, rendered: Element, options: MorphOptions): void {
  const liveKeyed = indexKeyed(live, options);
  const keyedElements = new Set<Node>(liveKeyed.values());
  const liveUnkeyed = Array.from(live.childNodes).filter((node) => !keyedElements.has(node));
  const claimed = new Set<Node>();
  const usedKeys = new Set<string>();
  const renderedNodes = Array.from(rendered.childNodes);
  let cursor: Node | null = live.firstChild;
  let unkeyedIndex = 0;

  for (let i = 0; i < renderedNodes.length; i += 1) {
    const next = renderedNodes[i] as Node;
    let kept: Node | null = null;
    let key = next instanceof Element ? keyOf(next, options) : undefined;
    // A repeated key on the rendered side pairs positionally like a live duplicate.
    if (key !== undefined && usedKeys.has(key)) key = undefined;
    if (key !== undefined) {
      usedKeys.add(key);
      const candidate = liveKeyed.get(key);
      if (candidate !== undefined && !claimed.has(candidate)) {
        kept = reconcile(candidate, next, options) === candidate ? candidate : null;
        if (kept === null) {
          candidate.replaceWith(next);
          claimed.add(next);
          cursor = next.nextSibling;
          continue;
        }
      }
    } else {
      while (unkeyedIndex < liveUnkeyed.length) {
        const candidate = liveUnkeyed[unkeyedIndex] as Node;
        unkeyedIndex += 1;
        if (claimed.has(candidate)) continue;
        if (sameKind(candidate, next)) {
          kept = reconcile(candidate, next, options) === candidate ? candidate : null;
          if (kept === null) {
            live.replaceChild(next, candidate);
            claimed.add(next);
            cursor = next.nextSibling;
          }
          break;
        }
        if (candidate instanceof Element) {
          // `next` is a text/comment, or an element whose kind the following
          // rendered node matches: an insertion, so the live element stays for it.
          const following = renderedNodes[i + 1];
          if (
            !(next instanceof Element) ||
            (following !== undefined && sameKind(candidate, following))
          ) {
            unkeyedIndex -= 1;
            break;
          }
          live.replaceChild(next, candidate);
          claimed.add(next);
          cursor = next.nextSibling;
          break;
        }
        if (!(next instanceof Element)) {
          // Text vs comment: replace rather than rewrite one node type's value into the other.
          live.replaceChild(next, candidate);
          claimed.add(next);
          cursor = next.nextSibling;
          break;
        }
        // A surplus live text/comment before the element `next` needs; removed below.
      }
      if (kept === null && claimed.has(next)) continue;
    }

    const node: Node = kept ?? next;
    claimed.add(node);
    // Whitespace-only text the template did not render is surplus. Stepping the
    // cursor over it keeps a retained element where it is: `insertBefore` on a
    // node already in the tree is a remove-and-insert, which blurs a focused input.
    while (cursor !== null && cursor !== node && !claimed.has(cursor) && isBlankText(cursor)) {
      cursor = cursor.nextSibling;
    }
    if (node !== cursor) live.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }

  for (const child of Array.from(live.childNodes)) {
    if (!claimed.has(child)) child.remove();
  }
}

/** Retain `candidate` when it can be edited toward `next`; otherwise report `next`. */
function reconcile(candidate: Node, next: Node, options: MorphOptions): Node {
  if (candidate instanceof Element && next instanceof Element) {
    // A compatible boundary stays exactly as it is (ADR 0008 §4).
    if (isMorphBoundary(candidate) && isMorphBoundary(next)) return candidate;
    return morphElement(candidate, next, options);
  }
  if (candidate.nodeValue !== next.nodeValue) candidate.nodeValue = next.nodeValue;
  return candidate;
}

function isBlankText(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim().length === 0;
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a instanceof Element && b instanceof Element) {
    return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI;
  }
  return true;
}

/** First element per key; later duplicates are left as they are and pair positionally. */
function indexKeyed(parent: Element, options: MorphOptions): Map<string, Element> {
  const keyed = new Map<string, Element>();
  let duplicate: string | undefined;
  for (const child of Array.from(parent.children)) {
    const key = keyOf(child, options);
    if (key === undefined) continue;
    if (keyed.has(key)) {
      duplicate ??= key.slice(key.indexOf('=') + 1);
      continue;
    }
    keyed.set(key, child);
  }
  if (duplicate !== undefined) options.onDuplicateKey?.(parent, duplicate);
  return keyed;
}

interface FocusSnapshot {
  readonly element: HTMLElement;
  readonly selection: readonly [number | null, number | null] | null;
}

/** A keyed move is a remove-and-insert, which blurs; remember what had focus. */
function captureFocus(live: Element): FocusSnapshot | null {
  const active = live.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !live.contains(active)) return null;
  const selection =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? ([active.selectionStart, active.selectionEnd] as const)
      : null;
  return { element: active, selection };
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (snapshot === null) return;
  const { element, selection } = snapshot;
  if (element.ownerDocument.activeElement === element || !element.isConnected) return;
  try {
    element.focus({ preventScroll: true });
    const [start, end] = selection ?? [null, null];
    if (start !== null && end !== null) {
      (element as HTMLInputElement).setSelectionRange(start, end);
    }
  } catch {
    // Not focusable any more; nothing to restore.
  }
}
