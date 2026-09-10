/**
 * The plugin boundary on a value's way to its binding. Transforms are consumer
 * code: their result is frozen into the scheduler entry, an error is reported
 * as LP0602 and the original value kept, and a thenable is a contract error —
 * a transform that awaits would hand the scheduler a promise to render.
 */

import type { RuntimeDeps } from './runtime-state';
import { observeThenableResult } from './thenable';
import type { CachedElement } from './types';

/** Never awaited: every consumer callback may accept a newer revision synchronously (ADR 0004). */
export function transformForBinding(
  deps: RuntimeDeps,
  target: CachedElement,
  originalValue: unknown,
  allFields: Record<string, unknown>,
  isCurrent: () => boolean,
): unknown {
  const transform = deps.transformValue;
  if (transform === undefined) return originalValue;
  try {
    const transformed = transform(
      target.fieldName,
      originalValue,
      { element: target.element, allFields },
      isCurrent,
    );
    const returnedThenable = observeThenableResult(transformed);
    if (!isCurrent()) return originalValue;
    if (returnedThenable) {
      throw new TypeError(
        `Transform for "${target.fieldName}" returned a thenable; transforms must be synchronous`,
      );
    }
    return transformed;
  } catch (err) {
    if (!isCurrent()) return originalValue;
    const error = err instanceof Error ? err : new Error(String(err));
    void deps.emitter.emit('error', { error, context: 'transform', code: 'LP0602' });
    return originalValue;
  }
}
