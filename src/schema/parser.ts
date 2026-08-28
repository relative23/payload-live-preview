/**
 * Validates the `fieldSchemaJSON` the admin sends. Entries that fail
 * validation are dropped, never thrown: a Payload/runtime version mismatch
 * must not take the preview down.
 */

import type { PayloadBlockSchema, PayloadFieldSchema } from '@/types/payload-protocol';

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
