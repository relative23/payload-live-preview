/**
 * Apply `ArrayPatch[]` to a DOM container.
 *
 * The structural applier turns the diff produced by `@schema/diff`
 * into individual DOM operations — keyed placement, removal, and root
 * replacement — instead of rebuilding the whole list. The result is:
 *
 *   - smaller paint area (browsers can keep most nodes alive),
 *   - synchronous, lifecycle-attributable DOM updates,
 *   - consumer JS state on existing child elements survives.
 *
 * Each child element is paired with the `id` of its source item via
 * the `data-payload-key` attribute. Items without an `id` use their
 * positional index — which means moves degrade to update-in-place,
 * but inserts/removes still work.
 *
 * @module @core/structural-applier
 */

import { sanitizeHtml, type SanitizeOptions } from '@security/sanitizer';
import { trustedHtml } from '@security/trusted-types';
import { interpolateArrayTemplate } from './array-template';
import { safeStringify } from '@field-types/utils';
import { diffArray, type ArrayPatch } from '@schema/diff';
import { morphElement } from './morph';

export const KEY_ATTRIBUTE = 'data-payload-key';
const NESTED_KEY_ATTRIBUTE = 'data-payload-nested-key';
const NESTED_TEMPLATE_ATTRIBUTE = 'data-payload-nested-template';

/**
 * Per-render memory of the last value seen for each item key, used by
 * recursive nested diffs. It is **not** module-level: the caller owns
 * the store (one per runtime instance — see
 * `createStructuralArrayRenderer`), so two clients never share diff
 * state and `destroy()` drops it with the instance. The store is keyed
 * by the container element, then by the item's key from `readKey()`.
 */
export type StructuralStore = WeakMap<Element, Map<string, unknown>>;

/** Create a fresh, instance-owned structural-diff store. */
export function createStructuralStore(): StructuralStore {
  return new WeakMap<Element, Map<string, unknown>>();
}

export interface StructuralApplyOptions {
  readonly template: string;
  readonly container: Element;
  readonly patches: readonly ArrayPatch[];
  /**
   * The full new array, so inserts/replaces can render items by index.
   * The diff carries `value`, but a single value isn't enough to
   * render the item *via* a template — we still need the index to
   * substitute `{{index}}` correctly. The applier picks the value at
   * the patch's `to`/`index` from this snapshot.
   */
  readonly nextItems: readonly unknown[];
  /**
   * Instance-owned nested-diff memory. Pass the same store across
   * renders of the same runtime so nested arrays diff incrementally.
   */
  readonly store: StructuralStore;
  /** Re-render existing items even when their data comparison is unchanged. */
  readonly forceRender?: boolean;
  /**
   * Edit a changed item's live element toward its re-rendered markup instead
   * of replacing it (ADR 0008). Default `true`; `false` is the pre-1.3.0
   * behaviour, kept for the benchmark that measures the two.
   */
  readonly morph?: boolean;
  /** Reported once per container when two items share a key (`LP0405`). */
  readonly onDuplicateKey?: (container: Element, key: string) => void;
}

/**
 * A nested slot whose rendered counterpart still carries a nested template
 * keeps its children for its own plan; the morph only aligns its attributes.
 * A slot whose template went away takes the rendered static content.
 */
function isManagedNestedSlot(_live: Element, rendered: Element): boolean {
  return (
    rendered.hasAttribute(NESTED_KEY_ATTRIBUTE) && rendered.hasAttribute(NESTED_TEMPLATE_ATTRIBUTE)
  );
}

/**
 * Reconcile patches in final-item order. Patch indices describe the `next`
 * snapshot, while live DOM indices change during moves; resolving keyed nodes
 * from the DOM before placing each final item avoids mixing those coordinate
 * systems. `nextItems` is authoritative and any unclaimed direct child is
 * removed after reconciliation.
 *
 * The applier mutates `container` in place. After a complete call, the
 * container's children mirror `nextItems`. It returns `true` for a real DOM
 * mutation, `false` for an already-current tree, and `null` when required item
 * markup has no sanitized element root. The latter is preflighted atomically,
 * so the previous DOM and diff memory stay intact.
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

// Plans are short-lived internal transaction records. Named tuples keep their
// positions explicit without emitting repeated object-property names into the
// inline runtime for every recursive plan node.
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
  /** The item at this index is a different one (`replace` patch): never morph the live element toward it. */
  replace: boolean,
];
type NestedSlotPlan = readonly [
  live: Element | null,
  rendered: Element,
  children: StructuralPlan | undefined,
];

/**
 * Materialize the complete recursive replacement tree before mutating live DOM.
 * Nested template failures therefore abort the same transaction as top-level
 * failures, while the plan still records which live slots can be transplanted
 * during commit to retain their DOM identity.
 */
function prepareStructuralPlan(
  container: Element,
  template: string,
  patches: readonly ArrayPatch[],
  nextItems: readonly unknown[],
  forceRender: boolean,
  store: StructuralStore,
): StructuralPlan | null {
  const patchPlan = createPatchPlan(patches);
  const memory = store.get(container);
  const entries = prepareReconciliation(
    container,
    template,
    nextItems,
    patchPlan,
    forceRender,
    memory,
    store,
  );
  if (entries === null) return null;
  return [container, entries, nextItems];
}

/** Commit a previously validated recursive plan; no rendering occurs here. */
interface CommitOptions {
  readonly morph: boolean;
  readonly onDuplicateKey: ((container: Element, key: string) => void) | undefined;
}

function commitStructuralPlan(
  plan: StructuralPlan,
  store: StructuralStore,
  options: CommitOptions,
): boolean {
  const [container, entries, nextItems] = plan;
  const claimed = new Set<Element>();
  let mutated = false;

  for (const entry of entries) {
    const [index, live, rendered, nestedSlots, replace] = entry;
    let node = live;

    if (rendered !== undefined) {
      // A changed item keeps its live element when the markup is compatible
      // (ADR 0008): attributes and children are edited in place, nested slots
      // are retained whole for their own plan below. Otherwise the pre-1.3.0
      // path — transplant the live slots into the rendered item and swap.
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
        for (const nested of nestedSlots) {
          if (nested[0] !== null) {
            synchronizeAttributes(nested[0], nested[1]);
            nested[1].replaceWith(nested[0]);
          }
        }
      }
      for (const nested of nestedSlots) {
        if (nested[2] !== undefined) {
          // The recursive plan targets the live slot — retained in place by the
          // morph, or transplanted into the rendered item — or the detached new
          // slot, so child identity survives exactly where valid.
          commitStructuralPlan(nested[2], store, options);
        }
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

    // `prepareReconciliation()` materializes every missing node or returns
    // `null` before this loop, so each entry owns one final child.
    if (node === null) continue;
    const before = container.children[index] ?? null;
    if (node !== before) {
      container.insertBefore(node, before);
      mutated = true;
    }
    claimed.add(node);
  }

  // The final snapshot is the source of truth. This also removes SSR children
  // that were not represented in the first incoming value.
  for (const child of Array.from(container.children)) {
    if (!claimed.has(child)) {
      child.remove();
      mutated = true;
    }
  }

  const memory = getMemory(container, store);
  memory.clear();
  for (const value of nextItems) rememberItem(memory, value);
  return mutated;
}

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

/**
 * Prepare each direct nested slot. Compatible live slots are recorded for a
 * later transplant; new/replaced slots are populated entirely off-DOM. A
 * failure at any depth propagates before commit starts.
 */
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
    // A slot without a usable nested template is no longer owned by recursive
    // reconciliation. Keep its fully preflighted static subtree authoritative
    // instead of transplanting stale children from the former managed slot.
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

/**
 * Return only this item's outermost nested slots. A transplanted slot owns the
 * recursion below it; visiting its descendants again from the parent would
 * reconcile detached template nodes and create a second source of truth.
 */
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

/** Copy new sanitized slot metadata without replacing its live child subtree. */
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
  if (!Array.isArray(nested)) return undefined;
  return nested as readonly unknown[];
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
  if (key === undefined) return;
  memory.set(key, value);
}

function readKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as Record<string, unknown>)['id'];
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return undefined;
}

function indexByAttribute(elements: readonly Element[], attribute: string): Map<string, Element[]> {
  const indexed = new Map<string, Element[]>();
  // Reverse insertion lets pop() consume duplicate keys in DOM order without
  // the O(n) shifting cost of queue arrays.
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

/**
 * Render one template item, with its `id` stamped on the root as
 * `data-payload-key` so subsequent diffs can find it again.
 *
 * The template body is sanitised — the same defense-in-depth applied
 * elsewhere — and parsed via `<template>` so we get a real Element
 * back instead of a string concatenation.
 */
function renderItem(
  ownerDocument: Document,
  template: string,
  value: unknown,
  index: number,
): Element | null {
  const filled = fillTemplate(template, value, index);
  const safe = sanitizeHtml(filled, templateSanitizeOptions(template));
  const host = ownerDocument.createElement('template');
  host.innerHTML = trustedHtml(safe);
  const first = host.content.firstElementChild;
  if (!first) return null;
  const key = readKey(value);
  if (key !== undefined) first.setAttribute(KEY_ATTRIBUTE, key);
  return first;
}

function fillTemplate(template: string, value: unknown, index: number): string {
  return interpolateArrayTemplate(template, value, index, safeStringify);
}

/**
 * Elements an item template may contain beyond the sanitizer's default
 * allow-list. The template is the page author's markup — the same trust as
 * the page — while every interpolated value is escaped to text before the
 * sanitizer runs, so these tags can come only from the template. Interactive
 * and state-bearing elements are what ADR 0008 exists to preserve; custom
 * elements are boundaries the morph respects. Event handlers, `style` and
 * unsafe URLs are still stripped.
 */
const TEMPLATE_EXTRA_TAGS: readonly string[] = [
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'label',
  'details',
  'summary',
  'dialog',
  'video',
  'audio',
  'progress',
  'meter',
];
const TEMPLATE_EXTRA_ATTRIBUTES: readonly string[] = [
  'type',
  'name',
  'placeholder',
  'open',
  'disabled',
  'readonly',
  'required',
  'checked',
  'selected',
  'value',
  'min',
  'max',
  'step',
  'rows',
  'cols',
  'for',
  'controls',
  'muted',
  'loop',
  'poster',
  'src',
];
const TAG_NAME_PATTERN = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;
const templateOptionsCache = new Map<string, SanitizeOptions>();

function templateSanitizeOptions(template: string): SanitizeOptions {
  const cached = templateOptionsCache.get(template);
  if (cached !== undefined) return cached;
  const custom = new Set<string>();
  for (const match of template.matchAll(TAG_NAME_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag !== undefined) custom.add(tag);
  }
  const tags = [...TEMPLATE_EXTRA_TAGS, ...custom];
  const attributes: Record<string, readonly string[]> = {};
  for (const tag of tags) attributes[tag] = TEMPLATE_EXTRA_ATTRIBUTES;
  const options: SanitizeOptions = {
    additionalAllowedTags: tags,
    additionalAllowedAttributes: attributes,
    allowFormControls: true,
  };
  templateOptionsCache.set(template, options);
  return options;
}
