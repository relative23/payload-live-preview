/**
 * Trend benchmark for adversarial ordered-token backlogs.
 *
 * Functional tests assert ordering and generation semantics. This benchmark
 * exists to catch accidental superlinear queue operations without turning
 * noisy wall-clock measurements into test assertions.
 */
import { bench, describe } from 'vitest';
import { MessageBus } from '@core/message-bus';

const TRUSTED_ORIGIN = 'https://admin.example.com';
const BACKLOG_SIZE = 1_000;

interface DeferredBoolean {
  readonly promise: Promise<boolean>;
  readonly resolve: (value: boolean) => void;
}

function deferredBoolean(): DeferredBoolean {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('revision pipeline', () => {
  bench('MessageBus — drain 1,000 ordered async token verdicts', async () => {
    const target = new EventTarget() as unknown as Window;
    const verdicts = Array.from({ length: BACKLOG_SIZE }, deferredBoolean);
    let validatorIndex = 0;
    let delivered = 0;
    const bus = new MessageBus(() => true, {
      validateToken: () => verdicts[validatorIndex++]!.promise,
      onUpdate: () => {
        delivered += 1;
      },
      onDocumentEvent: () => undefined,
    });
    bus.attach(target);

    for (let index = 0; index < BACKLOG_SIZE; index += 1) {
      target.dispatchEvent(
        new MessageEvent('message', {
          origin: TRUSTED_ORIGIN,
          data: {
            type: 'payload-live-preview',
            data: { index },
            previewToken: 'valid',
          },
        }),
      );
    }
    for (const verdict of verdicts) verdict.resolve(true);
    await Promise.all(verdicts.map(({ promise }) => promise));
    await Promise.resolve();
    bus.detach();

    if (delivered !== BACKLOG_SIZE) {
      throw new Error(`expected ${String(BACKLOG_SIZE)} deliveries, received ${String(delivered)}`);
    }
  });
});
