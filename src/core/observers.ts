/**
 * DOM observers — mutation tracking + visibility tracking.
 *
 * Two purposes:
 *
 *   1. Detect when new `data-payload-field` elements appear, when
 *      existing ones disappear, and when the field attribute itself
 *      changes. The observer debounces these mutations and then asks
 *      its host to rebuild the cache.
 *   2. Track which cached elements are within the viewport (with a
 *      configurable rootMargin). Updates for off-screen elements are
 *      queued by the scheduler and replayed when the element scrolls
 *      into view — solving the "stale offscreen content" bug from the
 *      legacy implementation.
 *
 * The observers are split from the cache and the scheduler because:
 *   - They are environment-specific (need `MutationObserver` and
 *     `IntersectionObserver`).
 *   - Tests can supply mock observers for deterministic timing.
 *
 * @module @core/observers
 */

import { FIELD_ATTRIBUTE } from './cache';

/**
 * Callbacks the observer manager invokes back into its host.
 */
export interface ObserverCallbacks {
  /** Invoked when the cache likely needs a rebuild. */
  readonly onStructuralChange: () => void;
  /** Invoked when an element enters or leaves the viewport. */
  readonly onVisibilityChange: (element: Element, isVisible: boolean) => void;
}

/**
 * Tunable parameters for the observer manager.
 */
export interface ObserverOptions {
  /** Debounce window for mutation events (ms). Default: 100. */
  readonly mutationDebounceMs?: number;
  /** rootMargin passed to IntersectionObserver. Default: `200px`. */
  readonly intersectionRootMargin?: string;
}

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_ROOT_MARGIN = '200px';

/**
 * Combined Mutation + Intersection observer.
 *
 * Lifecycle:
 *   - `start(root)` attaches the mutation observer to `root`.
 *   - `observeElement(el)` adds `el` to the intersection observer.
 *   - `unobserveElement(el)` removes it.
 *   - `stop()` disconnects everything; safe to call repeatedly.
 */
export class ObserverManager {
  readonly #callbacks: ObserverCallbacks;
  readonly #debounceMs: number;
  readonly #rootMargin: string;
  readonly #visible = new Set<Element>();
  #mutation: MutationObserver | null = null;
  #intersection: IntersectionObserver | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: ObserverCallbacks, options: ObserverOptions = {}) {
    this.#callbacks = callbacks;
    this.#debounceMs = options.mutationDebounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#rootMargin = options.intersectionRootMargin ?? DEFAULT_ROOT_MARGIN;
  }

  /** Begin observing `root` for mutations and create the intersection observer. */
  start(root: Node): void {
    this.#mutation = new MutationObserver((mutations) => {
      this.#handleMutations(mutations);
    });
    this.#mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [FIELD_ATTRIBUTE],
    });

    this.#intersection = new IntersectionObserver(
      (entries) => {
        this.#handleIntersection(entries);
      },
      { rootMargin: this.#rootMargin, threshold: 0 },
    );
  }

  /** Add an element to the intersection observer. */
  observeElement(element: Element): void {
    this.#intersection?.observe(element);
  }

  /** Remove an element from the intersection observer. */
  unobserveElement(element: Element): void {
    this.#intersection?.unobserve(element);
    this.#visible.delete(element);
  }

  /** Mark an element as currently visible. Useful for tests/seeding. */
  markVisible(element: Element, visible: boolean): void {
    if (visible) this.#visible.add(element);
    else this.#visible.delete(element);
  }

  /** Is `element` currently within the (margined) viewport? */
  isVisible(element: Element): boolean {
    return this.#visible.has(element);
  }

  /** Disconnect all observers and clear pending timers. */
  stop(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    this.#mutation?.disconnect();
    this.#intersection?.disconnect();
    this.#mutation = null;
    this.#intersection = null;
    this.#visible.clear();
  }

  #handleMutations(mutations: readonly MutationRecord[]): void {
    if (!hasStructuralImpact(mutations)) return;
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.#callbacks.onStructuralChange();
    }, this.#debounceMs);
  }

  #handleIntersection(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const target = entry.target;
      if (entry.isIntersecting) {
        if (!this.#visible.has(target)) {
          this.#visible.add(target);
          this.#callbacks.onVisibilityChange(target, true);
        }
      } else if (this.#visible.has(target)) {
        this.#visible.delete(target);
        this.#callbacks.onVisibilityChange(target, false);
      }
    }
  }
}

/**
 * Returns true iff any mutation in the batch affects the live preview
 * tracking attributes. This short-circuits the common case where DOM
 * activity is unrelated to the preview, avoiding spurious rebuilds.
 */
function hasStructuralImpact(mutations: readonly MutationRecord[]): boolean {
  for (const m of mutations) {
    if (m.type === 'attributes' && m.attributeName === FIELD_ATTRIBUTE) return true;
    for (const node of m.addedNodes) {
      if (containsTrackedElement(node)) return true;
    }
    for (const node of m.removedNodes) {
      if (containsTrackedElement(node)) return true;
    }
  }
  return false;
}

function containsTrackedElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  if (element.hasAttribute(FIELD_ATTRIBUTE)) return true;
  return element.querySelector(`[${FIELD_ATTRIBUTE}]`) !== null;
}
