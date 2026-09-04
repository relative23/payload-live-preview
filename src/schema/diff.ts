/**
 * Structural diff for array and blocks fields. Items with an `id` are keyed
 * (moves are detected); without ids the diff is positional.
 */

export type ArrayPatch =
  | { readonly kind: 'insert'; readonly index: number; readonly value: unknown }
  | { readonly kind: 'remove'; readonly index: number; readonly value: unknown }
  | {
      readonly kind: 'move';
      readonly from: number;
      readonly to: number;
      readonly value: unknown;
    }
  | { readonly kind: 'update'; readonly index: number; readonly value: unknown }
  | {
      readonly kind: 'replace';
      readonly index: number;
      readonly oldValue: unknown;
      readonly value: unknown;
    };

function getId(item: unknown): string | number | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const id = (item as Record<string, unknown>)['id'];
  if (typeof id === 'string' || typeof id === 'number') return id;
  return undefined;
}

function getBlockType(item: unknown): string | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const blockType = (item as Record<string, unknown>)['blockType'];
  return typeof blockType === 'string' ? blockType : undefined;
}

/** Patches that turn `prev` into `next`; a changed `blockType` is a `replace`, never an `update`. */
export function diffArray(
  prev: readonly unknown[],
  next: readonly unknown[],
): readonly ArrayPatch[] {
  const haveIds = next.every((item) => getId(item) !== undefined);
  if (haveIds) return diffById(prev, next);
  return diffByPosition(prev, next);
}

function diffById(prev: readonly unknown[], next: readonly unknown[]): readonly ArrayPatch[] {
  const patches: ArrayPatch[] = [];
  const prevIndexById = new Map<string | number, number>();
  for (let i = 0; i < prev.length; i += 1) {
    const id = getId(prev[i]);
    if (id !== undefined) prevIndexById.set(id, i);
  }

  const consumedFromPrev = new Set<number>();
  for (let to = 0; to < next.length; to += 1) {
    const item = next[to];
    const id = getId(item);
    if (id === undefined) {
      patches.push({ kind: 'insert', index: to, value: item });
      continue;
    }
    const from = prevIndexById.get(id);
    if (from === undefined) {
      patches.push({ kind: 'insert', index: to, value: item });
      continue;
    }
    consumedFromPrev.add(from);
    const prevItem = prev[from];
    if (getBlockType(prevItem) !== getBlockType(item)) {
      patches.push({ kind: 'replace', index: to, oldValue: prevItem, value: item });
      continue;
    }
    if (from !== to) {
      patches.push({ kind: 'move', from, to, value: item });
    }
    if (!shallowEqual(prevItem, item)) {
      patches.push({ kind: 'update', index: to, value: item });
    }
  }

  for (let i = 0; i < prev.length; i += 1) {
    if (consumedFromPrev.has(i)) continue;
    patches.push({ kind: 'remove', index: i, value: prev[i] });
  }
  return patches;
}

function diffByPosition(prev: readonly unknown[], next: readonly unknown[]): readonly ArrayPatch[] {
  const patches: ArrayPatch[] = [];
  const min = Math.min(prev.length, next.length);
  for (let i = 0; i < min; i += 1) {
    if (!shallowEqual(prev[i], next[i])) {
      patches.push({ kind: 'update', index: i, value: next[i] });
    }
  }
  if (next.length > prev.length) {
    for (let i = prev.length; i < next.length; i += 1) {
      patches.push({ kind: 'insert', index: i, value: next[i] });
    }
  }
  if (prev.length > next.length) {
    for (let i = next.length; i < prev.length; i += 1) {
      patches.push({ kind: 'remove', index: i, value: prev[i] });
    }
  }
  return patches;
}

// Shallow on purpose: any nested reference change is an update, and the
// renderer reconciles deeper differences itself.
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.is(aRec[key], bRec[key])) return false;
  }
  return true;
}
