import { describe, expect, it } from 'vitest';
import {
  focusFieldOf,
  isDocumentEventMessage,
  isObjectMessage,
  isPlainObject,
} from '@core/message-guards';

/** A typed message with extra fields, spread so the excess-property check does not apply. */
function message(type: string, extra: Record<string, unknown>): { type: string } {
  return { type, ...extra };
}

describe('isObjectMessage', () => {
  it.each([
    null,
    undefined,
    42,
    'payload-live-preview',
    true,
    [],
    {},
    { type: 42 },
    { type: null },
  ])('answers false, and does not throw, for %j', (value) => {
    expect(isObjectMessage(value)).toBe(false);
  });
  it('answers true for an object with a string type, whatever else it carries', () => {
    expect(isObjectMessage({ type: '' })).toBe(true);
    expect(isObjectMessage({ type: 'x', extra: 1 })).toBe(true);
  });
});

describe('focusFieldOf', () => {
  it.each([['title'], 42, true, {}, null, undefined, ''])(
    'has no field name when it is not a non-empty string (%j)',
    (field) => {
      expect(focusFieldOf(message('payload-live-preview-focus', { field }))).toBeUndefined();
    },
  );
  it('returns the field name when it is one', () => {
    expect(focusFieldOf(message('payload-live-preview-focus', { field: 'hero.title' }))).toBe(
      'hero.title',
    );
  });
});

describe('isDocumentEventMessage', () => {
  it.each(['updated', 'created', 'deleted'])('accepts each documented action, %s', (action) => {
    expect(isDocumentEventMessage(message('payload-document-event', { action }))).toBe(true);
  });
  it('accepts a string id as well as a finite number', () => {
    expect(isDocumentEventMessage(message('payload-document-event', { id: 'abc' }))).toBe(true);
    expect(isDocumentEventMessage(message('payload-document-event', { id: 42 }))).toBe(true);
    expect(isDocumentEventMessage(message('payload-document-event', { id: Number.NaN }))).toBe(
      false,
    );
    expect(isDocumentEventMessage(message('payload-document-event', { id: true }))).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('answers false for null rather than throwing', () => {
    expect(isPlainObject(null)).toBe(false);
  });
  it('accepts a literal and a null-prototype object, refuses a class instance', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Date(0))).toBe(false);
  });
});
