/**
 * `structural-array` renderer.
 *
 * Activates for elements that opt into structural updates via the
 * `data-payload-structural` attribute. Instead of rebuilding the
 * container's `innerHTML` on every update, the renderer diffs the
 * previous and next item lists and applies the minimal patch.
 *
 * All diff memory (previous top-level values, nested-diff store, and
 * the missing-template warning set) lives in closures created by
 * `createStructuralArrayRenderer()` — one set per runtime instance, so
 * two clients never share state and a destroyed client leaves nothing
 * behind at module scope. The renderer is wrapped in a View-Transition
 * so reorders animate where supported.
 *
 * @module @field-types/structural-array
 */

import { runWithTransition } from '@core/view-transitions';
import {
  applyStructuralPatches,
  createStructuralStore,
  type StructuralStore,
} from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import type { FieldRenderer } from '@core/types';

/**
 * Build a `structural-array` renderer with its own, instance-local diff
 * state. Called once per `buildBuiltinRenderers()` (i.e. once per
 * client/runtime), so nothing is shared across instances.
 */
export function createStructuralArrayRenderer(): FieldRenderer {
  const previousValues = new WeakMap<Element, readonly unknown[]>();
  const warnedContainers = new WeakSet<Element>();
  const store: StructuralStore = createStructuralStore();

  return {
    name: 'structural-array',
    render(target, value) {
      if (!Array.isArray(value)) return;
      const container = target.element;
      const template = target.arrayTemplate;
      if (template === undefined || template.length === 0) {
        warnMissingTemplate(warnedContainers, container, target.fieldName);
        return;
      }
      const previous = previousValues.get(container) ?? [];
      const patches = diffArray(previous, value);
      if (patches.length === 0) {
        previousValues.set(container, value.slice() as readonly unknown[]);
        return;
      }
      void runWithTransition(() => {
        applyStructuralPatches({
          template,
          container,
          patches,
          nextItems: value,
          store,
        });
      });
      previousValues.set(container, value.slice() as readonly unknown[]);
    },
  };
}

function warnMissingTemplate(
  warnedContainers: WeakSet<Element>,
  container: Element,
  fieldName: string,
): void {
  if (warnedContainers.has(container)) return;
  warnedContainers.add(container);
  console.warn(
    `[live-preview] Skipping structural update for "${fieldName}" — the ` +
      `<${container.tagName.toLowerCase()}> with data-payload-structural is missing ` +
      `data-payload-array-template. Add an inline template (e.g., ` +
      `data-payload-array-template="<li>{{label}}</li>") so the renderer can ` +
      `materialise new items.`,
  );
}
