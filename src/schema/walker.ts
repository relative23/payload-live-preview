/**
 * Schema walker.
 *
 * Walks a parsed Payload field schema and produces a flat index from
 * dotted-path field names (e.g., `hero.title`, `sections.0.heading`)
 * to the corresponding schema descriptor.
 *
 * The index is consumed by:
 *   - The runtime, to decide which field-type renderer applies.
 *   - The diff engine, to know when a structural change occurred.
 *
 * Tabs/rows/collapsibles are *structural* fields that have no `name`;
 * they are flattened into their inner fields.
 *
 * @module @schema/walker
 */

import type {
  PayloadBlockSchema,
  PayloadFieldSchema,
  PayloadFieldType,
} from '@/types/payload-protocol';

/**
 * Read-only view of a flattened schema. Keys are dotted-paths;
 * values are the original schema entries.
 */
export type SchemaIndex = ReadonlyMap<string, PayloadFieldSchema>;

const STRUCTURAL_TYPES: ReadonlySet<PayloadFieldType> = new Set<PayloadFieldType>([
  'tabs',
  'row',
  'collapsible',
]);

/**
 * Walk `schemas` recursively and build a flat index. The base path is
 * appended to every produced key. Pass an empty string at the
 * top-level entry point.
 */
export function buildSchemaIndex(
  schemas: readonly PayloadFieldSchema[],
  basePath = '',
): SchemaIndex {
  const out = new Map<string, PayloadFieldSchema>();
  walk(schemas, basePath, out);
  return out;
}

function walk(
  schemas: readonly PayloadFieldSchema[],
  basePath: string,
  out: Map<string, PayloadFieldSchema>,
): void {
  for (const schema of schemas) {
    if (STRUCTURAL_TYPES.has(schema.type)) {
      if (schema.fields) walk(schema.fields, basePath, out);
      continue;
    }
    if (schema.type === 'group') {
      const path = basePath === '' ? schema.name : `${basePath}.${schema.name}`;
      out.set(path, schema);
      if (schema.fields) walk(schema.fields, path, out);
      continue;
    }
    const path = basePath === '' ? schema.name : `${basePath}.${schema.name}`;
    out.set(path, schema);
    if (schema.type === 'array' && schema.fields) {
      walk(schema.fields, `${path}.*`, out);
    } else if (schema.type === 'blocks' && schema.blocks) {
      for (const block of schema.blocks) {
        walk(block.fields, `${path}.*.${block.slug}`, out);
      }
    }
  }
}

/**
 * Look up the schema entry for `fieldPath`, walking through array
 * (`.*`) and block (`.*.<slug>`) segments. Returns `undefined` when
 * the path is not represented in the schema.
 */
export function lookupSchema(
  index: SchemaIndex,
  fieldPath: string,
): PayloadFieldSchema | undefined {
  if (index.has(fieldPath)) return index.get(fieldPath);
  // Replace array indices (numeric segments) with wildcards.
  const wildcardPath = fieldPath.replace(/\.\d+(?=\.|$)/g, '.*');
  if (index.has(wildcardPath)) return index.get(wildcardPath);
  return undefined;
}

/**
 * Discover the block schema for a `blocks` field at `arrayPath`,
 * given the runtime value carries a `blockType` discriminator.
 */
export function lookupBlockSchema(
  index: SchemaIndex,
  blocksFieldPath: string,
  blockType: string,
): PayloadBlockSchema | undefined {
  const schema = lookupSchema(index, blocksFieldPath);
  if (!schema?.blocks) return undefined;
  return schema.blocks.find((b) => b.slug === blockType);
}
