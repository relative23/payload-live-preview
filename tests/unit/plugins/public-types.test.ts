import { describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import type { PluginManagerOptions } from '@plugins/manager';
import type { LivePreviewPlugin } from '@plugins/types';

/**
 * Compile-time regressions for the 1.0.x plugin callback contracts.
 *
 * Registration methods historically returned `void`, so both synchronous and
 * async expression-bodied init hooks are valid `LivePreviewPlugin` values. Keep
 * these assignments intact: Vitest exercises the emitted values while
 * `npm run typecheck` pins their source compatibility.
 */
const synchronousExpressionPlugin: LivePreviewPlugin = {
  name: 'synchronous-expression',
  init: (context) => context.registerTransform('title', (value) => value),
};

const asynchronousExpressionPlugin: LivePreviewPlugin = {
  name: 'asynchronous-expression',
  // eslint-disable-next-line @typescript-eslint/require-await -- the expression body is the compatibility seam
  init: async (context) => context.registerFieldRenderer({ name: 'text', render: () => undefined }),
};

function createLegacyManagerOptions(renderers: FieldRenderer[]): PluginManagerOptions {
  return {
    events: new EventEmitter(),
    config: {},
    // Array#push is a representative pre-1.0.4 expression callback. A
    // contextually void host callback may return a value that the manager must
    // neither reject at compile time nor mistake for a disposer at runtime.
    registerFieldRenderer: (renderer) => renderers.push(renderer),
    log: () => undefined,
  };
}

describe('public plugin types', () => {
  it('retain expression-bodied 1.0.x init hooks', () => {
    expect([synchronousExpressionPlugin.name, asynchronousExpressionPlugin.name]).toEqual([
      'synchronous-expression',
      'asynchronous-expression',
    ]);
  });

  it('retains expression-bodied void PluginManager host callbacks', () => {
    const renderers: FieldRenderer[] = [];
    const options = createLegacyManagerOptions(renderers);
    options.registerFieldRenderer({ name: 'text', render: () => undefined });
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- compile-time 1.0.x return contract
    const logged: void = options.log('legacy result contract');

    expect(renderers).toHaveLength(1);
    expect(logged).toBeUndefined();
  });
});
