/** Shape guards for the messages the bus accepts. `null` counts as absent, as JSON bridges send it. */

import type {
  PayloadDocumentEventMessage,
  PayloadFieldSchema,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';
import { parseFieldSchema } from '@schema/parser';

export function isObjectMessage(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

/** A `payload-live-preview` message: `data` a plain object when present, scalars of the right type or absent. */
export function isLivePreviewMessage(value: { type: string }): value is PayloadLivePreviewMessage {
  const v = value as Record<string, unknown>;
  if (v['data'] !== undefined && v['data'] !== null && !isPlainObject(v['data'])) return false;
  return (
    optionalTypeOk(v['fieldSchemaJSON'], (x) => Array.isArray(x)) &&
    optionalTypeOk(v['globalSlug'], (x) => typeof x === 'string') &&
    optionalTypeOk(v['collectionSlug'], (x) => typeof x === 'string') &&
    optionalTypeOk(v['locale'], (x) => typeof x === 'string') &&
    optionalTypeOk(v['ready'], (x) => typeof x === 'boolean') &&
    optionalTypeOk(v['previewToken'], (x) => typeof x === 'string') &&
    optionalTypeOk(v['protocolVersion'], (x) => typeof x === 'number')
  );
}

/** The non-empty field name of a `payload-live-preview-focus` message, else `undefined`. */
export function focusFieldOf(value: { type: string }): string | undefined {
  const field = (value as Record<string, unknown>)['field'];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

/** Stock Payload sends only the `type`; custom senders may add the typed fields (omitted, never `null`). */
export function isDocumentEventMessage(value: {
  type: string;
}): value is PayloadDocumentEventMessage {
  const v = value as Record<string, unknown>;
  return (
    optionalFieldOk(v['action'], (x) => x === 'updated' || x === 'created' || x === 'deleted') &&
    optionalFieldOk(v['slug'], (x) => typeof x === 'string') &&
    optionalFieldOk(
      v['id'],
      (x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)),
    )
  );
}

function optionalFieldOk(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function optionalTypeOk(value: unknown, check: (v: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

const NULL_AS_ABSENT_FIELDS = [
  'data',
  'fieldSchemaJSON',
  'globalSlug',
  'collectionSlug',
  'locale',
  'ready',
  'previewToken',
  'protocolVersion',
] as const satisfies readonly (keyof PayloadLivePreviewMessage)[];

/**
 * Drop `null` optionals so downstream sees the strict public type, and parse
 * the field schema entry by entry (malformed entries are dropped). Unknown
 * fields stay, for protocol evolution.
 */
export function normalizeLivePreviewMessage(
  message: PayloadLivePreviewMessage,
): PayloadLivePreviewMessage {
  const normalized = { ...message };
  for (const field of NULL_AS_ABSENT_FIELDS) {
    const wireValue: unknown = Reflect.get(normalized, field);
    if (wireValue === null) Reflect.deleteProperty(normalized, field);
  }
  if (!Array.isArray(normalized.fieldSchemaJSON)) return normalized;
  let fieldSchemaJSON: readonly PayloadFieldSchema[];
  try {
    fieldSchemaJSON = parseFieldSchema(normalized.fieldSchemaJSON);
  } catch {
    fieldSchemaJSON = [];
  }
  return { ...normalized, fieldSchemaJSON };
}
