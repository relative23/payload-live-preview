import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MessageBus, type MessageHandlers, type MessageRevision } from '@core/message-bus';
import { propertyParameters } from './fast-check';

const TRUSTED_ORIGIN = 'https://admin.example.test';

function messageTarget(): Window & { dispatchEvent: (event: Event) => boolean } {
  return new EventTarget() as unknown as Window & { dispatchEvent: (event: Event) => boolean };
}

function dispatch(target: { dispatchEvent: (event: Event) => boolean }, data: unknown): void {
  target.dispatchEvent(new MessageEvent('message', { data, origin: TRUSTED_ORIGIN }));
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

describe('MessageBus properties', () => {
  it('rejects generated invalid optional field types without leaking an update', () => {
    const invalidField = fc.constantFrom(
      ['fieldSchemaJSON', 'not-an-array'] as const,
      ['globalSlug', 42] as const,
      ['collectionSlug', false] as const,
      ['locale', {}] as const,
      ['ready', 'yes'] as const,
      ['previewToken', 17] as const,
      ['protocolVersion', '1'] as const,
    );

    fc.assert(
      fc.property(invalidField, fc.jsonValue(), ([field, invalid], extra) => {
        const target = messageTarget();
        const updates: unknown[] = [];
        const invalidReasons: string[] = [];
        const bus = new MessageBus((origin) => origin === TRUSTED_ORIGIN, {
          onUpdate: (message) => updates.push(message),
          onDocumentEvent: () => undefined,
          onInvalid: (reason) => invalidReasons.push(reason),
        });
        bus.attach(target);
        try {
          dispatch(target, {
            type: 'payload-live-preview',
            data: { title: 'safe' },
            extensionField: extra,
            [field]: invalid,
          });
          expect(updates).toEqual([]);
          expect(invalidReasons).toEqual(['shape']);
        } finally {
          bus.detach();
        }
      }),
      propertyParameters(0x4d534731),
    );
  });

  it('commits asynchronous token verdicts in ingress order regardless of settlement order', async () => {
    const cases = fc.array(
      fc.record({ approved: fc.boolean(), settlementRank: fc.integer({ min: 0, max: 1_000 }) }),
      { minLength: 1, maxLength: 14 },
    );

    await fc.assert(
      fc.asyncProperty(cases, async (generated) => {
        const target = messageTarget();
        const verdicts = generated.map(() => deferred<boolean>());
        const delivered: { readonly index: number; readonly identity: MessageRevision }[] = [];
        const rejected: number[] = [];
        const handlers: MessageHandlers = {
          validateToken: (token) => {
            const index = Number(token);
            const verdict = verdicts[index];
            if (verdict === undefined) throw new Error(`missing verdict for ${String(token)}`);
            return verdict.promise;
          },
          onUpdate: (message, _origin, identity) => {
            const index = message.data?.['index'];
            if (typeof index !== 'number' || identity === undefined) {
              throw new Error('generated message lost its identity');
            }
            delivered.push({ index, identity });
          },
          onDocumentEvent: () => undefined,
          onInvalid: (reason, origin) => {
            if (reason !== 'token' || origin !== TRUSTED_ORIGIN) {
              throw new Error(`unexpected rejection: ${reason} ${origin}`);
            }
            rejected.push(1);
          },
        };
        const bus = new MessageBus((origin) => origin === TRUSTED_ORIGIN, handlers);
        bus.attach(target);
        try {
          for (const index of generated.keys()) {
            dispatch(target, {
              type: 'payload-live-preview',
              data: { index },
              previewToken: String(index),
            });
          }

          const settlementOrder = generated
            .map(({ settlementRank }, index) => ({ index, settlementRank }))
            .sort((left, right) =>
              left.settlementRank === right.settlementRank
                ? right.index - left.index
                : left.settlementRank - right.settlementRank,
            );
          for (const { index } of settlementOrder) {
            verdicts[index]?.resolve(generated[index]?.approved ?? false);
            await drainMicrotasks();
          }

          const approvedIndices = generated.flatMap(({ approved }, index) =>
            approved ? [index] : [],
          );
          expect(delivered.map(({ index }) => index)).toEqual(approvedIndices);
          expect(delivered.map(({ index, identity }) => identity.revision - 1 - index)).toEqual(
            approvedIndices.map(() => 0),
          );
          expect(delivered.every(({ identity }) => identity.generation === 1)).toBe(true);
          expect(rejected).toHaveLength(generated.length - approvedIndices.length);
        } finally {
          bus.detach();
        }
      }),
      propertyParameters(0x4d534732, 60),
    );
  });
});
