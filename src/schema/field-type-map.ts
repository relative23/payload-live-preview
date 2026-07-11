/**
 * Translate Payload field types into our internal renderer names.
 *
 * Payload's type vocabulary is mostly 1:1 with ours, with a handful
 * of structural containers that get absorbed (the walker already
 * flattens `tabs`/`row`/`collapsible`, so the renderer never sees
 * them). Unknown / unmapped types fall back to `text` — that keeps
 * the preview functional even for new Payload field types we haven't
 * specifically renderer-supported yet.
 *
 * @module @schema/field-type-map
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
  group: 'text', // group itself has no display; bound element shows nothing useful
  tabs: 'text', // structural — walker should have stripped this
  row: 'text',
  collapsible: 'text',
  relationship: 'relationship',
  upload: 'upload',
  point: 'text',
  json: 'text',
  code: 'text',
  ui: 'text',
};

/**
 * Resolve a Payload field type to the renderer name we ship with.
 * Returns `undefined` when the type isn't in the table (unknown / new
 * Payload type) so the caller can decide whether to fall back to the
 * DOM-attribute or to `text`.
 */
export function payloadTypeToRenderer(type: string): FieldType | undefined {
  if (Object.prototype.hasOwnProperty.call(MAP, type)) {
    return MAP[type as PayloadFieldType];
  }
  return undefined;
}
