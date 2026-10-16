/**
 * Wire schemas are optional hints, so refusing an unsafe hint must preserve the
 * accepted document. These cases exercise the real bounded parser and its caller.
 */
import { describe, expect, it } from 'vitest';
import { normalizeLivePreviewMessage } from '@core/message-guards';
import type { PayloadLivePreviewMessage } from '@/types/payload-protocol';

const title = { name: 'title', type: 'text' };

function normalized(schema: unknown): PayloadLivePreviewMessage {
  const message = {
    type: 'payload-live-preview',
    data: { title: 'Unsaved title' },
    locale: 'fr',
    fieldSchemaJSON: schema,
    extension: 'preserved',
  } as PayloadLivePreviewMessage;
  const result = normalizeLivePreviewMessage(message);
  expect(result.data).toEqual({ title: 'Unsaved title' });
  expect(result.locale).toBe('fr');
  expect(Reflect.get(result, 'extension')).toBe('preserved');
  expect(message.fieldSchemaJSON).toBe(schema);
  return result;
}

describe('schema hints at live-preview normalization', () => {
  it('keeps valid entries while dropping malformed hints', () => {
    expect(normalized([null, {}, title]).fieldSchemaJSON).toEqual([title]);
  });

  it('refuses the whole hint when a schema accessor throws', () => {
    const hostile = {
      get name() {
        throw new Error('Untrusted schema accessor');
      },
      type: 'text',
    };
    expect(normalized([title, hostile]).fieldSchemaJSON).toEqual([]);
  });

  it('refuses a cyclic hint while preserving the accepted document', () => {
    const fields: unknown[] = [];
    fields.push({ name: 'group', type: 'group', fields });
    expect(normalized(fields).fieldSchemaJSON).toEqual([]);
  });

  it('refuses schema depth above64 instead of returning a partial schema', () => {
    let fields: unknown[] = [title];
    for (let level = 0; level < 65; level += 1) {
      fields = [{ name: 'group', type: 'group', fields }];
    }
    expect(normalized(fields).fieldSchemaJSON).toEqual([]);
  });

  it('refuses schema work above10000 nodes instead of returning a partial schema', () => {
    expect(normalized(Array.from({ length: 10_001 }, () => title)).fieldSchemaJSON).toEqual([]);
  });
});
