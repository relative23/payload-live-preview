/**
 * Payload field type → renderer name. Structural containers the walker has
 * already flattened, and types without a display, map to `text` so a new
 * Payload field type never leaves a binding without a renderer.
 */

import type { FieldType } from '@core/types';
import type { PayloadFieldType } from '@/types/payload-protocol';

const MAP: Readonly<Record<PayloadFieldType, FieldType>> = {
  text: 'text',
  textarea: 'textarea',
  richText: 'richText',
  email: 'email',
  number: 'number',
  checkbox: 'checkbox',
  date: 'date',
  select: 'select',
  radio: 'radio',
  array: 'array',
  blocks: 'blocks',
  group: 'text',
  tabs: 'text',
  row: 'text',
  collapsible: 'text',
  relationship: 'relationship',
  upload: 'upload',
  point: 'text',
  json: 'text',
  code: 'text',
  ui: 'text',
};

/** `undefined` for a type not in the table, so the caller can fall back to the DOM attribute. */
export function payloadTypeToRenderer(type: string): FieldType | undefined {
  if (Object.prototype.hasOwnProperty.call(MAP, type)) {
    return MAP[type as PayloadFieldType];
  }
  return undefined;
}
