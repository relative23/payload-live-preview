import { describe, it } from 'vitest';
import fc, { type Arbitrary, type AsyncCommand } from 'fast-check';
import { propertyParameters } from './fast-check';
import {
  DestroyAllPlugins,
  EmitPluginEvent,
  type PluginModel,
  type PluginReal,
  RegisterPlugin,
  UnregisterPlugin,
  createPluginReal,
} from './models/plugins';

describe('PluginManager ownership and cleanup properties', () => {
  it('models plugin listener, transform, renderer, cleanup, and destroy ownership', async () => {
    const name = fc.constantFrom('alpha', 'beta', 'gamma');
    const commands: Arbitrary<AsyncCommand<PluginModel, PluginReal>>[] = [
      name.map((value) => new RegisterPlugin(value)),
      name.map((value) => new UnregisterPlugin(value)),
      fc.constant(new DestroyAllPlugins()),
      fc.constant(new EmitPluginEvent()),
    ];

    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 40 }), async (generated) => {
        let real: PluginReal | undefined;
        try {
          await fc.asyncModelRun(() => {
            real = createPluginReal();
            return {
              model: { active: [], registrations: 0, removals: 0, eventCalls: 0 },
              real,
            };
          }, generated);
        } finally {
          await real?.manager.destroyAll();
        }
      }),
      propertyParameters(0x504c4731, 60),
    );
  });
});
