/**
 * Applies an `ArrayPatch[]` diff to a container as keyed DOM operations
 * instead of rebuilding the list, so consumer state on surviving children is
 * kept. Items are paired by `data-payload-key` (the item `id`); items without
 * one pair by position. Nested arrays reconcile recursively through
 * `data-payload-nested-key` slots. See ADR 0008.
 */

import { sanitizeHtml } from '@security/sanitizer';
import { trustedHtml } from '@security/trusted-types';
import { interpolateArrayTemplate } from './array-template';
import { safeStringify } from '@field-types/utils';
import { diffArray, type ArrayPatch } from '@schema/diff';
import { morphElement } from './morph';
import { templateSanitizeOptions } from './template-sanitize';

export const KEY_ATTRIBUTE = 'data-payload-key';
const NESTED_KEY_ATTRIBUTE = 'data-payload-nested-key';
const NESTED_TEMPLATE_ATTRIBUTE = 'data-payload-nested-template';

/** Last value seen per item key, per container; owned by the caller so instances never share it. */
export type StructuralStore = WeakMap<Element, Map<string, unknown>>;

export function createStructuralStore(): StructuralStore {
  return new WeakMap<Element, Map<string, unknown>>();
}

export interface StructuralApplyOptions {
  readonly template: string;
  readonly container: Element;
  readonly patches: readonly ArrayPatch[];
  /** The full new array; inserts and replaces render by index from it. */
  readonly nextItems: readonly unknown[];
  /** Pass the same store across renders so nested arrays diff incrementally. */
  readonly store: StructuralStore;
  /** Re-render existing items even when unchanged. */
  readonly forceRender?: boolean;
  /** Edit a changed item in place instead of replacing it. Default `true`. */
  readonly morph?: boolean;
  /** Reported once per container when two items share a key (`LP0405`). */
  readonly onDuplicateKey?: (container: Element, key: string) => void;
}

/**
 * Returns `true` for a DOM mutation, `false` for an already-current tree, and
 * `null` when an item's markup has no sanitized element root — preflighted
 * before any mutation, so the previous DOM and memory stay intact.
 */
export function applyStructuralPatches(options: StructuralApplyOptions): boolean | null {
  const { template, container, patches, nextItems, store, forceRender = false } = options;
  const plan = prepareStructuralPlan(container, template, patches, nextItems, forceRender, store);
  if (plan === null) return null;
  return commitStructuralPlan(plan, store, {
    morph: options.morph ?? true,
    onDuplicateKey: options.onDuplicateKey,
  });
}

// Plan records are tuples: many are created per recursive render, and named
// keys would repeat in the inline bundle.
type StructuralPlan = readonly [
  container: Element,
  entries: readonly ReconciliationEntry[],
  nextItems: readonly unknown[],
];
type ReconciliationEntry = readonly [
  index: number,
  live: Element | null,
  rendered: Element | undefined,
  nestedSlots: readonly NestedSlotPlan[],
  /** A `replace` patch: a different item, never morphed toward. */
  replace: boolean,
];
type NestedSlotPlan = readonly [
  live: Element | null,
  rendered: Element,
  children: StructuralPlan | undefined,
];

interface CommitOptions {
  readonly morph: boolean;
  readonly onDuplicateKey: ((container: Element, key: string) => void) | undefined;
}

/** A rendered slot that still carries a nested template keeps its children for its own plan. */
function isManagedNestedSlot(_live: Element, rendered: Element): boolean {
  return (
    rendered.hasAttribute(NESTED_KEY_ATTRIBUTE) && rendered.hasAttribute(NESTED_TEMPLATE_ATTRIBUTE)
  );
}

/** Materialise the whole recursive replacement tree before touching live DOM. */
function prepareStructuralPlan(
  container: Element,
  template: string,
  patches: readonly ArrayPatch[],
  nextItems: readonly unknown[],
  forceRender: boolean,
  store: StructuralStore,
): StructuralPlan | null {
  const entries = prepareReconciliation(
    container,
    template,
    nextItems,
    createPatchPlan(patches),
    forceRender,
    store.get(container),
    store,
  );
  return entries === null ? null : [container, entries, nextItems];
}

function commitStructuralPlan(
  plan: StructuralPlan,
  store: StructuralStore,
  options: CommitOptions,
): boolean {
  const [container, entries, nextItems] = plan;
  const claimed = new Set<Element>();
  let mutated = false;
  for (const [index, live, rendered, nestedSlots, replace] of entries) {
    let node = live;
    if (rendered !== undefined) {
      // Morph a compatible live item in place; otherwise transplant its live
      // nested slots into the rendered item and swap.
      const retained =
        options.morph && !replace && live !== null
          ? morphElement(live, rendered, {
              keyAttributes: [KEY_ATTRIBUTE, NESTED_KEY_ATTRIBUTE],
              retainChildrenOf: isManagedNestedSlot,
              ...(options.onDuplicateKey !== undefined
                ? { onDuplicateKey: options.onDuplicateKey }
                : {}),
            }) === live
          : false;
      if (!retained) {
        for (const [liveSlot, renderedSlot] of nestedSlots) {
          if (liveSlot === null) continue;
          synchronizeAttributes(liveSlot, renderedSlot);
          renderedSlot.replaceWith(liveSlot);
        }
      }
      for (const [, , children] of nestedSlots) {
        if (children !== undefined) commitStructuralPlan(children, store, options);
      }
      if (retained) {
        mutated = true;
      } else {
        if (live !== null) {
          live.replaceWith(rendered);
          mutated = true;
        }
        node = rendered;
      }
    }
    if (node === null) continue;
    const before = container.children[index] ?? null;
    if (node !== before) {
      container.insertBefore(node, before);
      mutated = true;
    }
    claimed.add(node);
  }
  // `nextItems` is the source of truth; this also drops SSR children the first value did not carry.
  for (const child of Array.from(container.children)) {
    if (claimed.has(child)) continue;
    child.remove();
    mutated = true;
  }
  const memory = getMemory(container, store);
  memory.clear();
  for (const value of nextItems) rememberItem(memory, value);
  return mutated;
}

/**
 * Pair every final item with a live child (by key, else by position) and
 * render what needs rendering. Patch indices describe `next`, live indices
 * move during reconciliation, so keyed nodes are resolved from the DOM first.
 */
function prepareReconciliation(
  container: Element,
  template: string,
  nextItems: readonly unknown[],
  plan: PatchPlan,
  forceRender: boolean,
  memory: ReadonlyMap<string, unknown> | undefined,
  store: StructuralStore,
): readonly ReconciliationEntry[] | null {
  const initialChildren = Array.from(container.children);
  const keyedChildren = indexByAttribute(initialChildren, KEY_ATTRIBUTE);
  const reserved = new Set<Element>();
  const entries: ReconciliationEntry[] = [];
  for (let index = 0; index < nextItems.length; index += 1) {
    const value = nextItems[index];
    const key = readKey(value);
    let live =
      key === undefined
        ? (initialChildren[index] ?? null)
        : (takeIndexedElement(keyedChildren, key) ?? null);
    if (live !== null && reserved.has(live)) live = null;
    if (live !== null) reserved.add(live);
    const replace = plan.replaces.has(index);
    const needsRender = forceRender || plan.renders.has(index) || live === null;
    const rendered = needsRender
      ? renderItem(container.ownerDocument, template, value, index)
      : undefined;
    if (rendered === null) return null;
    const nestedSlots =
      rendered === undefined
        ? []
        : prepareNestedSlots(replace ? null : live, rendered, value, memory, store);
    if (nestedSlots === null) return null;
    entries.push([index, live, rendered ?? undefined, nestedSlots, replace]);
  }
  return entries;
}

interface PatchPlan {
  readonly renders: ReadonlySet<number>;
  readonly replaces: ReadonlySet<number>;
}

function createPatchPlan(patches: readonly ArrayPatch[]): PatchPlan {
  const renders = new Set<number>();
  const replaces = new Set<number>();
  for (const patch of patches) {
    if (patch.kind === 'insert' || patch.kind === 'update') renders.add(patch.index);
    else if (patch.kind === 'replace') {
      renders.add(patch.index);
      replaces.add(patch.index);
    }
  }
  return { renders, replaces };
}

/** Plan each direct nested slot; a failure at any depth aborts before commit. */
function prepareNestedSlots(
  oldItem: Element | null,
  newItem: Element,
  nextValue: unknown,
  memory: ReadonlyMap<string, unknown> | undefined,
  store: StructuralStore,
): readonly NestedSlotPlan[] | null {
  const oldSlots = oldItem === null ? [] : findDirectNestedSlots(oldItem);
  const oldSlotsByKey = indexByAttribute(oldSlots, NESTED_KEY_ATTRIBUTE);
  const itemKey = readKey(nextValue);
  const prevValue = itemKey !== undefined ? memory?.get(itemKey) : undefined;
  const plans: NestedSlotPlan[] = [];
  for (const newSlot of findDirectNestedSlots(newItem)) {
    const key = newSlot.getAttribute(NESTED_KEY_ATTRIBUTE);
    if (key === null) continue;
    const oldSlot = takeIndexedElement(oldSlotsByKey, key) ?? null;
    const nextTemplate = newSlot.getAttribute(NESTED_TEMPLATE_ATTRIBUTE);
    // Without a nested template the slot's rendered static content is authoritative.
    const liveSlot = nextTemplate ? oldSlot : null;
    const previousTemplate = liveSlot?.getAttribute(NESTED_TEMPLATE_ATTRIBUTE) ?? null;
    let children: StructuralPlan | undefined;
    if (nextTemplate) {
      const nextNested = readNestedArray(nextValue, key);
      if (nextNested !== undefined || liveSlot !== null) {
        const resolvedNext = nextNested ?? [];
        const prevNested = liveSlot === null ? [] : (readNestedArray(prevValue, key) ?? []);
        const patches = diffArray(prevNested, resolvedNext);
        const templateChanged = liveSlot !== null && previousTemplate !== nextTemplate;
        if (patches.length > 0 || templateChanged) {
          children =
            prepareStructuralPlan(
              liveSlot ?? newSlot,
              nextTemplate,
              patches,
              resolvedNext,
              templateChanged,
              store,
            ) ?? undefined;
          if (children === undefined) return null;
        }
      }
    }
    plans.push([liveSlot, newSlot, children]);
  }
  return plans;
}

/** Only the outermost nested slots: a transplanted slot owns the recursion below it. */
function findDirectNestedSlots(item: Element): readonly Element[] {
  return Array.from(item.querySelectorAll(`[${NESTED_KEY_ATTRIBUTE}]`)).filter((slot) => {
    let ancestor = slot.parentElement;
    while (ancestor !== null && ancestor !== item) {
      if (ancestor.hasAttribute(NESTED_KEY_ATTRIBUTE)) return false;
      ancestor = ancestor.parentElement;
    }
    return ancestor === item;
  });
}

function synchronizeAttributes(target: Element, source: Element): void {
  for (const attribute of Array.from(target.attributes)) {
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(source.attributes)) {
    if (target.getAttribute(attribute.name) !== attribute.value) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
}

function readNestedArray(value: unknown, key: string): readonly unknown[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return Array.isArray(nested) ? (nested as readonly unknown[]) : undefined;
}

function getMemory(container: Element, store: StructuralStore): Map<string, unknown> {
  let map = store.get(container);
  if (!map) {
    map = new Map();
    store.set(container, map);
  }
  return map;
}

function rememberItem(memory: Map<string, unknown>, value: unknown): void {
  const key = readKey(value);
  if (key !== undefined) memory.set(key, value);
}

function readKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as Record<string, unknown>)['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function indexByAttribute(elements: readonly Element[], attribute: string): Map<string, Element[]> {
  const indexed = new Map<string, Element[]>();
  // Reverse order so pop() yields duplicates in DOM order.
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element === undefined) continue;
    const key = element.getAttribute(attribute);
    if (key === null) continue;
    const bucket = indexed.get(key);
    if (bucket === undefined) indexed.set(key, [element]);
    else bucket.push(element);
  }
  return indexed;
}

function takeIndexedElement(indexed: Map<string, Element[]>, key: string): Element | undefined {
  return indexed.get(key)?.pop();
}

/** Render one item; its `id` is stamped as `data-payload-key` so later diffs find it. */
function renderItem(
  ownerDocument: Document,
  template: string,
  value: unknown,
  index: number,
): Element | null {
  const filled = interpolateArrayTemplate(template, value, index, safeStringify);
  const safe = sanitizeHtml(filled, templateSanitizeOptions(template));
  const host = ownerDocument.createElement('template');
  host.innerHTML = trustedHtml(safe);
  const first = host.content.firstElementChild;
  if (!first) return null;
  const key = readKey(value);
  if (key !== undefined) first.setAttribute(KEY_ATTRIBUTE, key);
  return first;
}
