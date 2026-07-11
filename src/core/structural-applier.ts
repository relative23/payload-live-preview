/**
 * Apply `ArrayPatch[]` to a DOM container.
 *
 * The structural applier turns the diff produced by `@schema/diff`
 * into individual DOM operations — `insertBefore`, `removeChild`,
 * `replaceChild`, in-place text update — instead of rebuilding the
 * whole list. The result is:
 *
 *   - smaller paint area (browsers can keep most nodes alive),
 *   - View-Transitions animate moves automatically,
 *   - consumer JS state on existing child elements survives.
 *
 * Each child element is paired with the `id` of its source item via
 * the `data-payload-key` attribute. Items without an `id` use their
 * positional index — which means moves degrade to update-in-place,
 * but inserts/removes still work.
 *
 * @module @core/structural-applier
 */

import { escapeHtml } from '@security/escape';
import { sanitizeHtml } from '@security/sanitizer';
import { diffArray, type ArrayPatch } from '@schema/diff';

const KEY_ATTRIBUTE = 'data-payload-key';
const NESTED_KEY_ATTRIBUTE = 'data-payload-nested-key';
const NESTED_TEMPLATE_ATTRIBUTE = 'data-payload-nested-template';

/**
 * Per-container memory of the last value rendered for each item key.
 * Used by recursive diffs: when an item updates, we need to know which
 * of its nested arrays *previously* held what, so we can compute the
 * minimal nested patch instead of rebuilding the whole sub-tree.
 *
 * The map is keyed by the container element (per-instance state — no
 * module singletons), then by the item's key from `readKey()`. Items
 * without an `id` aren't tracked, which is fine because they cannot
 * survive a positional diff anyway.
 */
const previousItemValues = new WeakMap<Element, Map<string, unknown>>();

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
}

/**
 * Apply patches in a deterministic order: removes first (so indices
 * stay valid), then inserts, then moves, then updates.
 *
 * The applier mutates `container` in place. After the call, the
 * container's children mirror `nextItems`.
 */
export function applyStructuralPatches(options: StructuralApplyOptions): void {
  const { template, container, patches } = options;
  const memory = getMemory(container);

  // Bucket the patches so we can apply each kind in a safe order.
  const removes: ArrayPatch[] = [];
  const inserts: ArrayPatch[] = [];
  const moves: ArrayPatch[] = [];
  const updates: ArrayPatch[] = [];
  const replaces: ArrayPatch[] = [];
  for (const patch of patches) {
    if (patch.kind === 'remove') removes.push(patch);
    else if (patch.kind === 'insert') inserts.push(patch);
    else if (patch.kind === 'move') moves.push(patch);
    else if (patch.kind === 'update') updates.push(patch);
    else replaces.push(patch);
  }

  // Removes first — apply in descending index so earlier indices stay valid.
  removes.sort((a, b) => indexOf(b) - indexOf(a));
  for (const patch of removes) {
    if (patch.kind !== 'remove') continue;
    const node = container.children[patch.index];
    node?.remove();
    forgetItem(memory, patch.value);
  }

  // Replaces and updates touch existing nodes — index now refers to
  // the post-remove list, which is what `next` reports.
  for (const patch of replaces) {
    if (patch.kind !== 'replace') continue;
    const node = container.children[patch.index];
    const replacement = renderItem(template, patch.value, patch.index);
    if (!node || !replacement) continue;
    // Block-type changed — nested DOM has a different shape, so we
    // populate the new item's slots from scratch instead of transplanting.
    populateNestedSlots(replacement, patch.value);
    container.replaceChild(replacement, node);
    rememberItem(memory, patch.value);
  }
  for (const patch of updates) {
    if (patch.kind !== 'update') continue;
    const oldNode = container.children[patch.index];
    const newNode = renderItem(template, patch.value, patch.index);
    if (!oldNode || !newNode) continue;
    reconcileNestedSlots(oldNode, newNode, patch.value, memory);
    container.replaceChild(newNode, oldNode);
    rememberItem(memory, patch.value);
  }

  // Inserts: apply in ascending order so later indices stay valid.
  inserts.sort((a, b) => indexOf(a) - indexOf(b));
  for (const patch of inserts) {
    if (patch.kind !== 'insert') continue;
    const before = container.children[patch.index] ?? null;
    const node = renderItem(template, patch.value, patch.index);
    if (!node) continue;
    populateNestedSlots(node, patch.value);
    container.insertBefore(node, before);
    rememberItem(memory, patch.value);
  }

  // Moves last — by this point only the original nodes that didn't get
  // replaced/removed are still in the DOM, so the `from` index is now
  // shifted by earlier removes/inserts. We rely on `data-payload-key`
  // to relocate the node reliably.
  for (const patch of moves) {
    if (patch.kind !== 'move') continue;
    const key = readKey(patch.value);
    const node = key !== undefined ? findByKey(container, key) : null;
    if (!node) continue;
    const before = container.children[patch.to] ?? null;
    if (node === before) continue;
    container.insertBefore(node, before);
  }
}

/**
 * Walk every nested-array slot inside a freshly-rendered item and
 * populate its initial children. Called on `insert` and `replace`
 * (where the slot starts empty in the new DOM).
 *
 * A nested slot is any descendant element carrying both
 * `data-payload-nested-key` (which property of the item value holds
 * the nested array) and `data-payload-nested-template` (the inner
 * template for each nested child).
 */
function populateNestedSlots(item: Element, value: unknown): void {
  const slots = item.querySelectorAll(`[${NESTED_KEY_ATTRIBUTE}]`);
  for (const slot of Array.from(slots)) {
    const key = slot.getAttribute(NESTED_KEY_ATTRIBUTE);
    if (key === null) continue;
    const nestedTemplate = slot.getAttribute(NESTED_TEMPLATE_ATTRIBUTE);
    if (!nestedTemplate) continue;
    const nestedItems = readNestedArray(value, key);
    if (nestedItems === undefined) continue;
    const patches = diffArray([], nestedItems);
    if (patches.length === 0) continue;
    applyStructuralPatches({
      template: nestedTemplate,
      container: slot,
      patches,
      nextItems: nestedItems,
    });
  }
}

/**
 * Update path — preserve nested-slot DOM identity across an item
 * update. The freshly-rendered `newItem` has empty nested slots; we
 * transplant the corresponding live slots from `oldItem` into it and
 * then recursively diff each one against the previous nested value.
 *
 * This is the heart of B5: a label change on an outer card no longer
 * blows away the inner CTA list, and a CTA reorder no longer rebuilds
 * its parent card.
 */
function reconcileNestedSlots(
  oldItem: Element,
  newItem: Element,
  nextValue: unknown,
  memory: Map<string, unknown>,
): void {
  const oldSlots = oldItem.querySelectorAll(`[${NESTED_KEY_ATTRIBUTE}]`);
  if (oldSlots.length === 0) return;
  const itemKey = readKey(nextValue);
  const prevValue = itemKey !== undefined ? memory.get(itemKey) : undefined;
  for (const oldSlot of Array.from(oldSlots)) {
    const key = oldSlot.getAttribute(NESTED_KEY_ATTRIBUTE);
    if (key === null) continue;
    const newSlot = newItem.querySelector(
      `[${NESTED_KEY_ATTRIBUTE}="${cssEscape(key)}"]`,
    );
    if (!newSlot) continue;
    // Transplant the live slot into the new item — its children carry
    // any state (focus, animations, plugin bindings) that we want to
    // preserve.
    newSlot.replaceWith(oldSlot);
    const nestedTemplate =
      oldSlot.getAttribute(NESTED_TEMPLATE_ATTRIBUTE) ??
      newSlot.getAttribute(NESTED_TEMPLATE_ATTRIBUTE);
    if (!nestedTemplate) continue;
    const nextNested = readNestedArray(nextValue, key) ?? [];
    const prevNested = readNestedArray(prevValue, key) ?? [];
    const patches = diffArray(prevNested, nextNested);
    if (patches.length === 0) continue;
    applyStructuralPatches({
      template: nestedTemplate,
      container: oldSlot,
      patches,
      nextItems: nextNested,
    });
  }
}

function readNestedArray(value: unknown, key: string): readonly unknown[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  if (!Array.isArray(nested)) return undefined;
  return nested as readonly unknown[];
}

function getMemory(container: Element): Map<string, unknown> {
  let map = previousItemValues.get(container);
  if (!map) {
    map = new Map();
    previousItemValues.set(container, map);
  }
  return map;
}

function rememberItem(memory: Map<string, unknown>, value: unknown): void {
  const key = readKey(value);
  if (key === undefined) return;
  memory.set(key, value);
}

function forgetItem(memory: Map<string, unknown>, value: unknown): void {
  const key = readKey(value);
  if (key === undefined) return;
  memory.delete(key);
}

function indexOf(patch: ArrayPatch): number {
  if (patch.kind === 'move') return patch.to;
  return patch.index;
}

function readKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as Record<string, unknown>)['id'];
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return undefined;
}

function findByKey(container: Element, key: string): Element | null {
  return container.querySelector(`[${KEY_ATTRIBUTE}="${cssEscape(key)}"]`);
}

function cssEscape(value: string): string {
  // jsdom does not expose CSS.escape in older versions; fall through.
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

/**
 * Render one template item, with its `id` stamped on the root as
 * `data-payload-key` so subsequent diffs can find it again.
 *
 * The template body is sanitised — the same defense-in-depth applied
 * elsewhere — and parsed via `<template>` so we get a real Element
 * back instead of a string concatenation.
 */
function renderItem(template: string, value: unknown, index: number): Element | null {
  if (typeof document === 'undefined') return null;
  const filled = fillTemplate(template, value, index);
  const safe = sanitizeHtml(filled);
  const host = document.createElement('template');
  host.innerHTML = safe;
  const first = host.content.firstElementChild;
  if (!first) return null;
  const key = readKey(value);
  if (key !== undefined) first.setAttribute(KEY_ATTRIBUTE, key);
  return first;
}

function fillTemplate(template: string, value: unknown, index: number): string {
  let out = template;
  if (typeof value === 'object' && value !== null) {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const pattern = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
      out = out.replace(pattern, escapeHtml(stringifyForTemplate(raw)));
    }
  } else {
    out = out.replace(/\{\{value\}\}/g, escapeHtml(stringifyForTemplate(value)));
  }
  return out.replace(/\{\{index\}\}/g, String(index));
}

function stringifyForTemplate(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { KEY_ATTRIBUTE };
