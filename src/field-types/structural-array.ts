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
 * behind at module scope. DOM mutations are applied synchronously: the
 * renderer contract is synchronous, so lifecycle completion can never
 * precede a deferred browser callback or outlive runtime destruction.
 *
 * @module @field-types/structural-array
 */

import { safeConsoleWarn } from '@core/diagnostics';
import { markNoWriteCallback } from '@core/internal-outcome';
import {
  applyStructuralPatches,
  createStructuralStore,
  KEY_ATTRIBUTE,
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
  const states = new WeakMap<Element, StructuralRenderState>();
  const warnedContainers = new WeakSet<Element>();
  const store: StructuralStore = createStructuralStore();

  return {
    name: 'structural-array',
    render: markNoWriteCallback((target, value) => {
      if (!Array.isArray(value)) return false;
      const container = target.element;
      const template = target.arrayTemplate;
      if (template === undefined || template.length === 0) {
        warnMissingTemplate(warnedContainers, container, target.fieldName);
        return false;
      }
      const previousState = states.get(container);
      const domSnapshot = readDomKeySnapshot(container);
      const previous = previousState?.values ?? valuesFromDomSnapshot(domSnapshot);
      const patches = diffArray(previous, value);
      const forceRender = needsForcedRender(previousState, template, domSnapshot);
      if (patches.length === 0 && !forceRender) {
        states.set(container, {
          values: value.slice() as readonly unknown[],
          template,
          domSnapshot,
        });
        return false;
      }
      const applied = applyStructuralPatches({
        template,
        container,
        patches,
        nextItems: value,
        store,
        forceRender,
      });
      if (applied === null) return false;
      states.set(container, {
        values: value.slice() as readonly unknown[],
        template,
        domSnapshot: readDomKeySnapshot(container),
      });
      return applied ? undefined : false;
    }),
  };
}

interface StructuralRenderState {
  readonly values: readonly unknown[];
  readonly template: string;
  readonly domSnapshot: readonly (string | null)[];
}

function needsForcedRender(
  previous: StructuralRenderState | undefined,
  template: string,
  domSnapshot: readonly (string | null)[],
): boolean {
  if (previous === undefined) return true;
  return previous.template !== template || !sameDomKeySnapshot(previous.domSnapshot, domSnapshot);
}

/**
 * The DOM is part of first-render truth: SSR/static markup exists before this
 * renderer has an in-memory value snapshot. Direct-child keys let the first
 * update reconcile that markup rather than appending a second copy. Keeping the
 * last applied key snapshot also detects host replacement/reordering between
 * updates without retaining any extra element references.
 */
function readDomKeySnapshot(container: Element): readonly (string | null)[] {
  return Array.from(container.children, (child) => child.getAttribute(KEY_ATTRIBUTE));
}

function valuesFromDomSnapshot(snapshot: readonly (string | null)[]): readonly unknown[] {
  return snapshot.map((key, position) =>
    key === null ? { __payloadDomPosition: position } : { id: key },
  );
}

function sameDomKeySnapshot(
  previous: readonly (string | null)[],
  current: readonly (string | null)[],
): boolean {
  if (previous.length !== current.length) return false;
  return previous.every((key, index) => key === current[index]);
}

function warnMissingTemplate(
  warnedContainers: WeakSet<Element>,
  container: Element,
  fieldName: string,
): void {
  if (warnedContainers.has(container)) return;
  warnedContainers.add(container);
  safeConsoleWarn(
    `[live-preview] Skipping structural update for "${fieldName}": ` +
      `<${container.tagName.toLowerCase()} data-payload-structural> needs ` +
      `data-payload-array-template (for example "<li>{{label}}</li>").`,
  );
}
