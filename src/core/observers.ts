/**
 * Mutation and intersection observers: ask the host to rebuild the cache when
 * bindings appear, vanish or change metadata, and track which bound elements
 * are in the viewport so off-screen writes can wait. Kept apart from cache and
 * scheduler so tests can run without the browser observer APIs.
 */

import { BINDING_ATTRIBUTES, FIELD_ATTRIBUTE, OWNER_ATTRIBUTE } from './cache';

export interface ObserverCallbacks {
  readonly onStructuralChange: () => void;
  readonly onVisibilityChange: (element: Element, isVisible: boolean) => void;
}

export interface ObserverOptions {
  /** Debounce for mutation batches in ms. Default 100. */
  readonly mutationDebounceMs?: number;
  /** `rootMargin` for the IntersectionObserver. Default `200px`. */
  readonly intersectionRootMargin?: string;
}

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_ROOT_MARGIN = '200px';
/** `nodeType` is stable across realms; the global `Node` constructor is not. */
const ELEMENT_NODE = 1;

export class ObserverManager {
  private readonly callbacks: ObserverCallbacks;
  private readonly debounceMs: number;
  private readonly rootMargin: string;
  private readonly visible = new Set<Element>();
  private mutation: MutationObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every start/stop so deliveries from an older lifetime are inert. */
  private generation = 0;

  constructor(callbacks: ObserverCallbacks, options: ObserverOptions = {}) {
    this.callbacks = callbacks;
    this.debounceMs = options.mutationDebounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.rootMargin = options.intersectionRootMargin ?? DEFAULT_ROOT_MARGIN;
  }

  /** Observe `root`; a repeated start hands over cleanly. */
  start(root: Node): void {
    const previousGeneration = this.generation;
    this.stop();
    const generation = previousGeneration + 1;
    // A disconnect hook may have started a newer generation; it owns the lifecycle.
    if (this.generation !== generation) return;
    let mutation: MutationObserver | null = null;
    let intersection: IntersectionObserver | null = null;
    try {
      mutation = new MutationObserver((mutations) => {
        this.handleMutations(mutations, generation);
      });
      // Both resources exist before either is live, so a missing IntersectionObserver leaves nothing behind.
      intersection = new IntersectionObserver(
        (entries) => {
          this.handleIntersection(entries, generation);
        },
        { rootMargin: this.rootMargin, threshold: 0 },
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
    if (this.generation !== generation) {
      mutation.disconnect();
      intersection.disconnect();
      return;
    }
    this.mutation = mutation;
    this.intersection = intersection;
  }

  observeElement(element: Element): void {
    this.intersection?.observe(element);
  }

  unobserveElement(element: Element): void {
    this.intersection?.unobserve(element);
    this.visible.delete(element);
  }

  /** Seed visibility (tests). */
  markVisible(element: Element, visible: boolean): void {
    if (visible) this.visible.add(element);
    else this.visible.delete(element);
  }

  isVisible(element: Element): boolean {
    return this.visible.has(element);
  }

  /** Disconnect everything; safe to repeat. */
  stop(): void {
    // Invalidate first so queued deliveries and the timer are inert before disconnecting.
    this.generation += 1;
    const timer = this.debounceTimer;
    const mutation = this.mutation;
    const intersection = this.intersection;
    this.debounceTimer = null;
    this.mutation = null;
    this.intersection = null;
    this.visible.clear();
    if (timer !== null) clearTimeout(timer);
    try {
      mutation?.disconnect();
    } finally {
      intersection?.disconnect();
    }
  }

  private handleMutations(mutations: readonly MutationRecord[], generation: number): void {
    if (!this.isCurrentGeneration(generation) || !hasStructuralImpact(mutations)) return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    const timer = setTimeout(() => {
      if (!this.isCurrentGeneration(generation) || this.debounceTimer !== timer) return;
      this.debounceTimer = null;
      this.callbacks.onStructuralChange();
    }, this.debounceMs);
    this.debounceTimer = timer;
  }

  private handleIntersection(
    entries: readonly IntersectionObserverEntry[],
    generation: number,
  ): void {
    for (const entry of entries) {
      if (!this.isCurrentGeneration(generation)) return;
      const { target } = entry;
      if (entry.isIntersecting) {
        if (this.visible.has(target)) continue;
        this.visible.add(target);
        this.callbacks.onVisibilityChange(target, true);
      } else if (this.visible.has(target)) {
        this.visible.delete(target);
        this.callbacks.onVisibilityChange(target, false);
      }
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.generation === generation && this.intersection !== null;
  }
}

/** Whether a mutation batch can change what is bound; unrelated DOM activity never rebuilds. */
function hasStructuralImpact(mutations: readonly MutationRecord[]): boolean {
  for (const m of mutations) {
    if (
      m.type === 'attributes' &&
      m.attributeName !== null &&
      BINDING_ATTRIBUTES.includes(m.attributeName)
    ) {
      // The field and owner attributes matter anywhere; other metadata (notably
      // the native `type`) only on an element that is a binding.
      if (
        m.attributeName === FIELD_ATTRIBUTE ||
        m.attributeName === OWNER_ATTRIBUTE ||
        (m.target.nodeType === ELEMENT_NODE && (m.target as Element).hasAttribute(FIELD_ATTRIBUTE))
      ) {
        return true;
      }
    }
    for (const node of m.addedNodes) if (containsTrackedElement(node)) return true;
    for (const node of m.removedNodes) if (containsTrackedElement(node)) return true;
  }
  return false;
}

function containsTrackedElement(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  const element = node as Element;
  return (
    element.hasAttribute(FIELD_ATTRIBUTE) || element.querySelector(`[${FIELD_ATTRIBUTE}]`) !== null
  );
}
