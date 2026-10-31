/**
 * A binding on `items.0.title` follows the position, not the row: after a
 * reorder the title lands in the first element, while the image and the markup
 * nobody bound still belong to the row that stood there. Payload gives each row
 * an `id`, so a position that now holds another row is a patch the page cannot
 * show faithfully, and it goes to a strategy like any other.
 */

import { reportUnfaithfulPatch } from './fidelity';
import type { RuntimeDeps, RuntimeState } from './runtime-state';
import type { CachedElement } from './types';

/** The ids of the rows a path passes through, `undefined` for a path through no row. */
function rowsOnPath(fields: Readonly<Record<string, unknown>>, path: string): string | undefined {
  let rows: string | undefined;
  let value: unknown = fields;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null) break;
    value = (value as Record<string, unknown>)[segment];
    const id = /^\d+$/.test(segment) ? (value as { id?: unknown } | null | undefined)?.id : null;
    if (typeof id === 'string' || typeof id === 'number') rows = `${rows ?? ''}/${String(id)}`;
  }
  return rows;
}

/** Remember the rows behind `target`, and report it when another row now stands there. */
export function reportMovedRow(
  deps: RuntimeDeps,
  state: RuntimeState,
  target: CachedElement,
  fields: Readonly<Record<string, unknown>>,
  navigated: boolean,
): void {
  if (typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__) return;
  const rows = rowsOnPath(fields, target.fieldName);
  if (rows === undefined) return;
  // A replay still shows the page being left: the next message starts afresh.
  if (navigated) {
    state.rowsOfBinding.delete(target.element);
    return;
  }
  const prior = state.rowsOfBinding.get(target.element);
  state.rowsOfBinding.set(target.element, rows);
  if (prior === undefined || prior === rows) return;
  // The rows, not the value: rows of equal text move without a new value.
  reportUnfaithfulPatch(deps, state, target, 'stands in a row that moved', rows);
}
