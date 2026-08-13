/**
 * DOM observers — mutation tracking + visibility tracking.
 *
 * Two purposes:
 *
 *   1. Detect when new `data-payload-field` elements appear, when
 *      existing ones disappear, and when cached binding metadata changes.
 *      The observer debounces these mutations and then asks its host to
 *      rebuild the cache.
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

import { BINDING_ATTRIBUTES, FIELD_ATTRIBUTE } from './cache';

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
// `nodeType` values are stable across DOM realms; the global `Node`
// constructor is not (and is absent in pure Node/SSR environments).
const ELEMENT_NODE = 1;

const enum ObserverSlot {
  Callbacks,
  DebounceMs,
  RootMargin,
  Visible,
  Mutation,
  Intersection,
  DebounceTimer,
  Generation,
}

/**
 * One TS-private state record avoids private-field scaffolding in the inlined
 * runtime. Named slots keep lifecycle ownership explicit without property-name
 * mangling; this internal class never crosses the package boundary.
 */
type ObserverState = [
  callbacks: ObserverCallbacks,
  debounceMs: number,
  rootMargin: string,
  visible: Set<Element>,
  mutation: MutationObserver | null,
  intersection: IntersectionObserver | null,
  debounceTimer: ReturnType<typeof setTimeout> | null,
  generation: number,
];

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
  private readonly s: ObserverState;

  constructor(callbacks: ObserverCallbacks, options: ObserverOptions = {}) {
    this.s = [
      callbacks,
      options.mutationDebounceMs ?? DEFAULT_DEBOUNCE_MS,
      options.intersectionRootMargin ?? DEFAULT_ROOT_MARGIN,
      new Set<Element>(),
      null,
      null,
      null,
      0,
    ];
  }

  /** Begin observing `root` for mutations and create the intersection observer. */
  start(root: Node): void {
    // Restarting is an explicit resource hand-off. Disconnect before replacing
    // either handle so repeated starts cannot orphan observers or timers.
    const previousGeneration = this.s[ObserverSlot.Generation];
    this.stop();
    const generation = previousGeneration + 1;
    // A disconnect hook may synchronously start a newer observer generation.
    // That nested start owns the lifecycle; this older stack must build nothing.
    if (this.s[ObserverSlot.Generation] !== generation) return;
    let mutation: MutationObserver | null = null;
    let intersection: IntersectionObserver | null = null;
    try {
      mutation = new MutationObserver((mutations) => {
        this.#handleMutations(mutations, generation);
      });
      // Construct both resources before activating either one. If a host lacks
      // a usable IntersectionObserver, no MutationObserver may be left live.
      intersection = new IntersectionObserver(
        (entries) => {
          this.#handleIntersection(entries, generation);
        },
        { rootMargin: this.s[ObserverSlot.RootMargin], threshold: 0 },
      );
      mutation.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...BINDING_ATTRIBUTES],
      });
    } catch (error) {
      mutation?.disconnect();
      intersection?.disconnect();
      throw error;
    }
    // Constructors/observe are host boundaries. A re-entrant stop or start
    // invalidates these candidates before they can replace newer resources.
    if (this.s[ObserverSlot.Generation] !== generation) {
      mutation.disconnect();
      intersection.disconnect();
      return;
    }
    this.s[ObserverSlot.Mutation] = mutation;
    this.s[ObserverSlot.Intersection] = intersection;
  }

  /** Add an element to the intersection observer. */
  observeElement(element: Element): void {
    this.s[ObserverSlot.Intersection]?.observe(element);
  }

  /** Remove an element from the intersection observer. */
  unobserveElement(element: Element): void {
    this.s[ObserverSlot.Intersection]?.unobserve(element);
    this.s[ObserverSlot.Visible].delete(element);
  }

  /** Mark an element as currently visible. Useful for tests/seeding. */
  markVisible(element: Element, visible: boolean): void {
    if (visible) this.s[ObserverSlot.Visible].add(element);
    else this.s[ObserverSlot.Visible].delete(element);
  }

  /** Is `element` currently within the (margined) viewport? */
  isVisible(element: Element): boolean {
    return this.s[ObserverSlot.Visible].has(element);
  }

  /** Disconnect all observers and clear pending timers. */
  stop(): void {
    // Invalidate callbacks first. Queued observer deliveries and timers must
    // become inert before any owned resource is disconnected or cleared.
    this.s[ObserverSlot.Generation] += 1;
    const timer = this.s[ObserverSlot.DebounceTimer];
    const mutation = this.s[ObserverSlot.Mutation];
    const intersection = this.s[ObserverSlot.Intersection];
    this.s[ObserverSlot.DebounceTimer] = null;
    this.s[ObserverSlot.Mutation] = null;
    this.s[ObserverSlot.Intersection] = null;
    this.s[ObserverSlot.Visible].clear();
    if (timer !== null) clearTimeout(timer);
    try {
      mutation?.disconnect();
    } finally {
      intersection?.disconnect();
    }
  }

  #handleMutations(mutations: readonly MutationRecord[], generation: number): void {
    if (!this.#isCurrentGeneration(generation)) return;
    if (!hasStructuralImpact(mutations)) return;
    if (!this.#isCurrentGeneration(generation)) return;
    if (this.s[ObserverSlot.DebounceTimer] !== null) {
      clearTimeout(this.s[ObserverSlot.DebounceTimer]);
    }
    const timer = setTimeout(() => {
      if (!this.#isCurrentGeneration(generation) || this.s[ObserverSlot.DebounceTimer] !== timer) {
        return;
      }
      this.s[ObserverSlot.DebounceTimer] = null;
      this.s[ObserverSlot.Callbacks].onStructuralChange();
    }, this.s[ObserverSlot.DebounceMs]);
    this.s[ObserverSlot.DebounceTimer] = timer;
  }

  #handleIntersection(entries: readonly IntersectionObserverEntry[], generation: number): void {
    for (const entry of entries) {
      if (!this.#isCurrentGeneration(generation)) return;
      const target = entry.target;
      if (entry.isIntersecting) {
        if (!this.s[ObserverSlot.Visible].has(target)) {
          this.s[ObserverSlot.Visible].add(target);
          this.s[ObserverSlot.Callbacks].onVisibilityChange(target, true);
          if (!this.#isCurrentGeneration(generation)) return;
        }
      } else if (this.s[ObserverSlot.Visible].has(target)) {
        this.s[ObserverSlot.Visible].delete(target);
        this.s[ObserverSlot.Callbacks].onVisibilityChange(target, false);
        if (!this.#isCurrentGeneration(generation)) return;
      }
    }
  }

  #isCurrentGeneration(generation: number): boolean {
    return (
      this.s[ObserverSlot.Generation] === generation && this.s[ObserverSlot.Intersection] !== null
    );
  }
}

/**
 * Returns true iff any mutation in the batch affects the live preview
 * tracking attributes. This short-circuits the common case where DOM
 * activity is unrelated to the preview, avoiding spurious rebuilds.
 */
function hasStructuralImpact(mutations: readonly MutationRecord[]): boolean {
  for (const m of mutations) {
    if (
      m.type === 'attributes' &&
      m.attributeName !== null &&
      BINDING_ATTRIBUTES.includes(m.attributeName)
    ) {
      // The field attribute itself can add, remove, or retarget a binding. All
      // other metadata — especially the generic native `type` attribute — only
      // matters on an element that is still a live-preview binding. This keeps
      // unrelated form activity from causing whole-cache rebuilds.
      if (
        m.attributeName === FIELD_ATTRIBUTE ||
        (m.target.nodeType === ELEMENT_NODE && (m.target as Element).hasAttribute(FIELD_ATTRIBUTE))
      ) {
        return true;
      }
    }
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
  if (node.nodeType !== ELEMENT_NODE) return false;
  const element = node as Element;
  if (element.hasAttribute(FIELD_ATTRIBUTE)) return true;
  return element.querySelector(`[${FIELD_ATTRIBUTE}]`) !== null;
}
