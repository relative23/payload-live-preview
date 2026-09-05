/**
 * `structural-array` renderer (`data-payload-structural`): diffs the previous
 * and next item lists and patches the container through the keyed morph
 * (ADR 0008). All diff memory lives in the closure, one per client.
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
import { isEmptyValue } from './utils';

interface StructuralRenderState {
  readonly values: readonly unknown[];
  readonly template: string;
  readonly domSnapshot: readonly (string | null)[];
}

type WarnedCodes = WeakMap<Element, Set<string>>;

export function createStructuralArrayRenderer(): FieldRenderer {
  const states = new WeakMap<Element, StructuralRenderState>();
  const warnedContainers = new WeakSet<Element>();
  const warnedKeys: WarnedCodes = new WeakMap();
  const store: StructuralStore = createStructuralStore();

  return {
    name: 'structural-array',
    render: /* @__PURE__ */ markNoWriteCallback((target, rawValue, context) => {
      const value = isEmptyValue(rawValue) ? [] : rawValue;
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
        states.set(container, { values: value.slice(), template, domSnapshot });
        return false;
      }
      warnAboutKeys(warnedKeys, container, target.fieldName, previousState?.values, value);
      const applied = applyStructuralPatches({
        template,
        container,
        patches,
        nextItems: value,
        store,
        forceRender,
        sanitizerPolicy: context.sanitizerPolicy,
        onDuplicateKey: (owner, key) => {
          warnDuplicateKey(warnedKeys, owner, target.fieldName, key);
        },
      });
      if (applied === null) return false;
      states.set(container, {
        values: value.slice(),
        template,
        domSnapshot: readDomKeySnapshot(container),
      });
      return applied ? undefined : false;
    }),
  };
}

function needsForcedRender(
  previous: StructuralRenderState | undefined,
  template: string,
  domSnapshot: readonly (string | null)[],
): boolean {
  if (previous === undefined) return true;
  return previous.template !== template || !sameDomKeySnapshot(previous.domSnapshot, domSnapshot);
}

// SSR markup exists before any in-memory snapshot; its direct-child keys let
// the first update reconcile instead of appending a second copy.
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
    `[live-preview] LP0403: Skipping structural update for "${fieldName}": ` +
      `<${container.tagName.toLowerCase()} data-payload-structural> needs ` +
      `data-payload-array-template (for example "<li>{{label}}</li>").`,
  );
}

function itemKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as Record<string, unknown>)['id'];
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

/** Key problems degrade the morph, they do not break it; each is announced once per container (ADR 0008 §5). */
function warnAboutKeys(
  warned: WarnedCodes,
  container: Element,
  fieldName: string,
  previous: readonly unknown[] | undefined,
  next: readonly unknown[],
): void {
  const nextKeys = next.map(itemKey);
  const seen = new Set<string>();
  const duplicate = nextKeys.find((key) => {
    if (key === undefined) return false;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate !== undefined) warnDuplicateKey(warned, container, fieldName, duplicate);
  if (nextKeys.some((key) => key === undefined)) {
    warnOnce(
      warned,
      container,
      'LP0404',
      `LP0404: an item of "${fieldName}" has no id and pairs by ` +
        'position, so an insert re-renders every row after it. Give items a stable id.',
    );
  }
  if (previous?.length === next.length && next.length > 1) {
    const previousKeys = new Set(previous.map(itemKey).filter((key) => key !== undefined));
    const stable = nextKeys.some((key) => key !== undefined && previousKeys.has(key));
    if (previousKeys.size > 0 && !stable) {
      warnOnce(
        warned,
        container,
        'LP0406',
        `LP0406: every key of "${fieldName}" changed at once; the ` +
          'source generates ids per message, so no item can be retained across updates.',
      );
    }
  }
}

// Reached from the pre-diff check and from the morph's nested-slot check; one site, one message.
function warnDuplicateKey(
  warned: WarnedCodes,
  owner: Element,
  fieldName: string,
  key: string,
): void {
  warnOnce(
    warned,
    owner,
    'LP0405',
    `LP0405: two items of "${fieldName}" share the key "${key}"; later ones pair by ` +
      'position. Make `id` unique per item.',
  );
}

function warnOnce(warned: WarnedCodes, container: Element, code: string, message: string): void {
  let codes = warned.get(container);
  if (codes === undefined) {
    codes = new Set();
    warned.set(container, codes);
  }
  if (codes.has(code)) return;
  codes.add(code);
  safeConsoleWarn(`[live-preview] ${message}`);
}
