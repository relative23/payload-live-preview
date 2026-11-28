/**
 * An accepted transaction owns required raw fields; a wire handshake need not carry them.
 * These compile-time checks keep that internal distinction without narrowing the public message.
 */
import { expectTypeOf, it } from 'vitest';
import type { UpdateTransaction } from '@/runtime/core/session/runtime-state';
import type { PayloadLivePreviewMessage } from '@/runtime/types/payload-protocol';
it('requires captured raw fields only after transaction acceptance', () => {
  expectTypeOf<UpdateTransaction['rawData']>().toEqualTypeOf<Record<string, unknown>>();
  expectTypeOf<
    Omit<UpdateTransaction, 'rawData'> extends UpdateTransaction ? true : false
  >().toEqualTypeOf<false>();
  expectTypeOf<{
    readonly type: 'payload-live-preview';
  }>().toExtend<PayloadLivePreviewMessage>();
});
