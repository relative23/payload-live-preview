/**
 * Validates the `fieldSchemaJSON` the admin sends. Entries that fail
 * validation are dropped, never thrown: a Payload/runtime version mismatch
 * must not take the preview down.
 */

import type { PayloadBlockSchema, PayloadFieldSchema } from '@/types/payload-protocol';

interface ParseState {
  nodes: number;
  readonly active: WeakSet<object>;
}
function visit(state: ParseState): void {
  if (++state.nodes > 10_000) throw new Error('invalid or oversized field schema');
}
function enter(value: object, state: ParseState, depth: number): void {
  visit(state);
  if (depth > 64 || state.active.has(value)) throw new Error('invalid or oversized field schema');
  state.active.add(value);
}

export function parseFieldSchema(raw: unknown): readonly PayloadFieldSchema[] {
  try {
    return parseFields(raw, { nodes: 0, active: new WeakSet() }, 0);
  } catch {
    return [];
  }
}

function parseFields(
  raw: unknown,
  state: ParseState,
  depth: number,
): readonly PayloadFieldSchema[] {
  if (!Array.isArray(raw)) return [];
  enter(raw, state, depth);
  const out: PayloadFieldSchema[] = [];
  for (const entry of raw) {
    const parsed = parseFieldEntry(entry, state, depth);
    if (parsed) out.push(parsed);
  }
  state.active.delete(raw);
  return out;
}

function parseFieldEntry(
  value: unknown,
  state: ParseState,
  depth: number,
): PayloadFieldSchema | undefined {
  visit(state);
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = record['name'];
  const type = record['type'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof type !== 'string' || type.length === 0) return undefined;

  const fields = parseFields(record['fields'], state, depth + 1);
  const blocks = parseBlockSchema(record['blocks'], state, depth + 1);

  const result: Record<string, unknown> = { ...record, name, type };
  const relationTo = record['relationTo'];
  if (Array.isArray(relationTo)) {
    const targets: unknown[] = [];
    for (const target of relationTo) {
      visit(state);
      targets.push(target);
    }
    result['relationTo'] = targets;
  }
  if (fields.length > 0) result['fields'] = fields;
  else delete result['fields'];
  if (blocks.length > 0) result['blocks'] = blocks;
  else delete result['blocks'];

  return result as unknown as PayloadFieldSchema;
}

function parseBlockSchema(
  raw: unknown,
  state: ParseState,
  depth: number,
): readonly PayloadBlockSchema[] {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    enter(raw, state, depth);
    const blocks: PayloadBlockSchema[] = [];
    for (const slug in raw) {
      if (!Object.hasOwn(raw, slug)) continue;
      visit(state);
      const entry: unknown = Reflect.get(raw, slug);
      if (
        typeof entry !== 'object' ||
        entry === null ||
        ['__proto__', 'constructor', 'prototype'].includes(slug)
      ) {
        continue;
      }
      blocks.push({
        ...(entry as Record<string, unknown>),
        slug,
        fields: parseFields((entry as Record<string, unknown>)['fields'], state, depth + 1),
      });
    }
    state.active.delete(raw);
    return blocks;
  }
  if (!Array.isArray(raw)) return [];
  enter(raw, state, depth);
  const out: PayloadBlockSchema[] = [];
  for (const entry of raw) {
    visit(state);
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const slug = record['slug'];
    if (typeof slug !== 'string' || slug.length === 0) continue;
    const fields = parseFields(record['fields'], state, depth + 1);
    out.push({ ...record, slug, fields });
  }
  state.active.delete(raw);
  return out;
}
