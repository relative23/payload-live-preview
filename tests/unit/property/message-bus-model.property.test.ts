import { describe, it } from 'vitest';
import fc, { type Arbitrary, type Command } from 'fast-check';
import { propertyParameters } from './fast-check';
import {
  AdvanceBusGeneration,
  AttachBus,
  type BusModel,
  type BusReal,
  DetachBus,
  SendBusUpdate,
  createBusReal,
} from './models/message-bus';

describe('MessageBus attachment and revision properties', () => {
  it('models MessageBus attachment generations and monotonic revisions', () => {
    const commands: Arbitrary<Command<BusModel, BusReal>>[] = [
      fc.constant(new AttachBus()),
      fc.constant(new DetachBus()),
      fc.constant(new AdvanceBusGeneration()),
      fc.integer().map((value) => new SendBusUpdate(value)),
    ];

    fc.assert(
      fc.property(fc.commands(commands, { maxCommands: 50 }), (generated) => {
        let real: BusReal | undefined;
        try {
          fc.modelRun(() => {
            real = createBusReal();
            return {
              model: { attached: false, generation: 0, revision: 0, delivered: [] },
              real,
            };
          }, generated);
        } finally {
          real?.bus.detach();
        }
      }),
      propertyParameters(0x42555331, 80),
    );
  });
});
