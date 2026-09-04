/** The shared structural store and list builders for the patch suites. */

import { createStructuralStore, KEY_ATTRIBUTE } from '@core/structural-applier';

// One store shared across the file is safe: it's a WeakMap keyed by the
// container element, and every test builds fresh elements, so tests can't
// collide. Within a test, sequential calls on the same container share
// memory, which is exactly what the nested-reconciliation cases exercise.
export const store = createStructuralStore();

export function asLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function makeList(_template: string, items: readonly unknown[]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const id = record['id'];
      if (typeof id === 'string' || typeof id === 'number') {
        li.setAttribute(KEY_ATTRIBUTE, asLabel(id));
      }
      li.textContent = asLabel(record['label']);
    } else {
      li.textContent = asLabel(item);
    }
    ul.appendChild(li);
  }
  return ul;
}
