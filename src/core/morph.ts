/**
 * Keyed DOM morph for structural updates (ADR 0008).
 *
 * Edits a live element toward a freshly rendered one while keeping the live
 * nodes — and with them focus, selection, scroll position, playback, form
 * state and the listeners the site attached. Nothing is copied from node to
 * node; a node the morph cannot retain is replaced, as before the morph
 * existed.
 *
 * The morph never descends into a boundary: custom elements, hydrated
 * islands, `contenteditable` subtrees and anything marked
 * `data-payload-owned`. It retains a compatible boundary as a whole and
 * leaves it alone.
 *
 * @module @core/morph
 */

export const ISLAND_ATTRIBUTE = 'data-payload-island';
export const OWNED_ATTRIBUTE = 'data-payload-owned';

/** Attributes the CMS controls only when the template names them (ADR 0008 §3). */
const STATE_ATTRIBUTES: ReadonlySet<string> = new Set(['open', 'value', 'checked', 'selected']);

export interface MorphOptions {
  /**
   * Attributes that key child elements for pairing, tried in order; children
   * without any of them pair positionally.
   */
  readonly keyAttributes: readonly string[];
  /** Called once per parent when two children share a key; pairing degrades to positional for them. */
  readonly onDuplicateKey?: (parent: Element, key: string) => void;
  /**
   * Elements whose attributes are synchronised but whose children are left
   * exactly as they are — structural nested slots, reconciled by their own
   * plan after the morph.
   */
  readonly retainChildrenOf?: (live: Element, rendered: Element) => boolean;
}

function keyOf(element: Element, options: MorphOptions): string | undefined {
  for (const attribute of options.keyAttributes) {
    const value = element.getAttribute(attribute);
    if (value !== null) return `${attribute}=${value}`;
  }
  return undefined;
}

/**
 * Whether `element` is a subtree the morph must not enter (ADR 0008 §4).
 * Exported so the cache and the island bridge apply the same rule.
 */
export function isMorphBoundary(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag.includes('-')) return true;
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
 * Morph `live` toward `rendered`. Returns `live` when it was retained and
 * edited, or `rendered` when the two are incompatible — in which case the
 * caller replaces `live` with `rendered` itself. `rendered` is consumed: its
 * children may be moved into `live`.
 */
export function morphElement(live: Element, rendered: Element, options: MorphOptions): Element {
  if (!isMorphCompatible(live, rendered)) return rendered;
  syncAttributes(live, rendered);
  if (options.retainChildrenOf?.(live, rendered) !== true) morphChildren(live, rendered, options);
  return live;
}

/**
 * Set and remove attributes so `live` matches `rendered`, except that
 * state-bearing attributes are touched only when `rendered` carries them.
 */
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
  const liveUnkeyed = Array.from(live.childNodes).filter(
    (node) => !(node instanceof Element && keyOf(node, options) !== undefined),
  );
  const claimed = new Set<Node>();
  let cursor: Node | null = live.firstChild;
  let unkeyedIndex = 0;

  for (const next of Array.from(rendered.childNodes)) {
    let kept: Node | null = null;
    const nextKey = next instanceof Element ? keyOf(next, options) : undefined;
    if (nextKey !== undefined) {
      const key = nextKey;
      const candidate = liveKeyed.get(key);
      if (candidate !== undefined && !claimed.has(candidate)) {
        liveKeyed.delete(key);
        kept = reconcile(candidate, next, options) === candidate ? candidate : null;
        if (kept === null) {
          // Incompatible under the same key: the rendered node takes its place.
          candidate.replaceWith(next);
          claimed.add(next);
          cursor = next.nextSibling;
          continue;
        }
      }
    } else {
      // Positional pairing among unkeyed nodes of the same kind.
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
        // A live node of another kind at this position is surplus; it is removed below.
      }
      if (kept === null && claimed.has(next)) continue;
    }

    const node: Node = kept ?? next;
    claimed.add(node);
    // Place the node at the cursor; a retained node already there costs nothing.
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
    if (isMorphBoundary(candidate) && isMorphBoundary(next) && sameKind(candidate, next)) {
      // A compatible boundary stays exactly as it is (ADR 0008 §4).
      return candidate;
    }
    return morphElement(candidate, next, options);
  }
  // `sameKind()` admits only element pairs and text pairs here.
  if (candidate.nodeValue !== next.nodeValue) candidate.nodeValue = next.nodeValue;
  return candidate;
}

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a instanceof Element && b instanceof Element) {
    return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI;
  }
  return a.nodeType !== Node.COMMENT_NODE;
}

function indexKeyed(parent: Element, options: MorphOptions): Map<string, Element> {
  const keyed = new Map<string, Element>();
  let duplicate: string | undefined;
  for (const child of Array.from(parent.children)) {
    const key = keyOf(child, options);
    if (key === undefined) continue;
    if (keyed.has(key)) {
      // Later duplicates pair positionally (ADR 0008 §5); the first keeps the key.
      duplicate ??= key.slice(key.indexOf('=') + 1);
      for (const attribute of options.keyAttributes) child.removeAttribute(attribute);
      continue;
    }
    keyed.set(key, child);
  }
  if (duplicate !== undefined) options.onDuplicateKey?.(parent, duplicate);
  return keyed;
}
