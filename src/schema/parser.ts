/**
 * Schema parser.
 *
 * Validates and normalises the `fieldSchemaJSON` Payload sends along
 * with every live-preview message. The runtime uses the parsed schema
 * to auto-resolve field types (no DOM annotation needed for
 * type detection) and to drive the structural diff for arrays/blocks.
 *
 * The parser is **defensive**: schema entries that fail validation are
 * dropped silently rather than throwing. Payload's schema format is
 * stable, but a mismatch between Payload's version and ours must never
 * crash the preview.
 *
 * @module @schema/parser
 */

import type { PayloadBlockSchema, PayloadFieldSchema } from '@/types/payload-protocol';

/**
 * Parse a raw schema array.
 *
 * Accepts the JSON-decoded value from Payload's `fieldSchemaJSON`.
 * Returns an array of validated schemas with `unknown` extras stripped
 * back to a plain `Record<string, unknown>` shape.
 */
export function parseFieldSchema(raw: unknown): readonly PayloadFieldSchema[] {
  if (!Array.isArray(raw)) return [];
  const out: PayloadFieldSchema[] = [];
  for (const entry of raw) {
    const parsed = parseFieldEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseFieldEntry(value: unknown): PayloadFieldSchema | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = record['name'];
  const type = record['type'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof type !== 'string' || type.length === 0) return undefined;

  const fields = parseFieldSchema(record['fields']);
  const blocks = parseBlockSchema(record['blocks']);

  const result: Record<string, unknown> = { ...record, name, type };
  if (fields.length > 0) result['fields'] = fields;
  else delete result['fields'];
  if (blocks.length > 0) result['blocks'] = blocks;
  else delete result['blocks'];

  return result as unknown as PayloadFieldSchema;
}

function parseBlockSchema(raw: unknown): readonly PayloadBlockSchema[] {
  if (!Array.isArray(raw)) return [];
  const out: PayloadBlockSchema[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const slug = record['slug'];
    if (typeof slug !== 'string' || slug.length === 0) continue;
    const fields = parseFieldSchema(record['fields']);
    out.push({ ...record, slug, fields });
  }
  return out;
}
