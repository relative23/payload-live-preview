import { describe, expect, it } from 'vitest';
import type { DataMergerOptions } from '@core/data-merger';
import type { RuntimeOptions } from '@core/lifecycle';
import type { ApplyUpdate, ScheduledUpdate } from '@core/update-scheduler';
import type { FieldRenderer } from '@core/types';

/**
 * Compile-time regressions for established 1.0.x callback return contracts.
 *
 * Diagnostics are invoked through a fail-safe runtime bridge, but their public
 * type remains `void`: consumers may return the result from a void wrapper,
 * and expression callbacks returning incidental values stay assignable.
 */
const mergeOptions: DataMergerOptions = {
  serverURL: 'https://cms.example.test',
  log: () => undefined,
};

const runtimeDiagnostics: Pick<RuntimeOptions, 'log' | 'warn'> = {
  log: () => undefined,
  warn: () => undefined,
};

const scheduledUpdates: ScheduledUpdate[] = [];
const valueReturningApply: ApplyUpdate = (update) => scheduledUpdates.push(update);
const valueReturningRenderer: FieldRenderer = {
  name: 'text',
  render: (target) => target.element.toggleAttribute('data-rendered'),
};

function invokeMergeLog(): void {
  return mergeOptions.log?.('merge');
}

function invokeRuntimeLog(): void {
  return runtimeDiagnostics.log?.('runtime');
}

function invokeRuntimeWarn(): void {
  return runtimeDiagnostics.warn?.('warning');
}

describe('public core callback types', () => {
  it('keeps 1.0.x diagnostic return values void', () => {
    expect([invokeMergeLog(), invokeRuntimeLog(), invokeRuntimeWarn()]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps expression-bodied scheduler and renderer callbacks assignable to void contracts', () => {
    expect(valueReturningApply).toBeTypeOf('function');
    expect(valueReturningRenderer).toHaveProperty('render');
  });
});
