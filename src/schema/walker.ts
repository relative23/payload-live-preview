/**
 * Flattens a parsed field schema into dotted paths (`hero.title`,
 * `sections.*.heading`). Tabs, rows and collapsibles have no name and
 * dissolve into their inner fields.
 */

import type {
  PayloadBlockSchema,
  PayloadFieldSchema,
  PayloadFieldType,
} from '@/types/payload-protocol';

export type SchemaIndex = ReadonlyMap<string, PayloadFieldSchema>;

const STRUCTURAL_TYPES: ReadonlySet<PayloadFieldType> = new Set<PayloadFieldType>([
  'tabs',
  'row',
  'collapsible',
]);

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
    const path = basePath === '' ? schema.name : `${basePath}.${schema.name}`;
    out.set(path, schema);
    if (schema.type === 'group') {
      if (schema.fields) walk(schema.fields, path, out);
    } else if (schema.type === 'array' && schema.fields) {
      walk(schema.fields, `${path}.*`, out);
    } else if (schema.type === 'blocks' && schema.blocks) {
      for (const block of schema.blocks) {
        walk(block.fields, `${path}.*.${block.slug}`, out);
      }
    }
  }
}

/** Schema for `fieldPath`; numeric segments are retried as `*` wildcards. */
export function lookupSchema(
  index: SchemaIndex,
  fieldPath: string,
): PayloadFieldSchema | undefined {
  if (index.has(fieldPath)) return index.get(fieldPath);
  const wildcardPath = fieldPath.replace(/\.\d+(?=\.|$)/g, '.*');
  if (index.has(wildcardPath)) return index.get(wildcardPath);
  return undefined;
}

export function lookupBlockSchema(
  index: SchemaIndex,
  blocksFieldPath: string,
  blockType: string,
): PayloadBlockSchema | undefined {
  const schema = lookupSchema(index, blocksFieldPath);
  if (!schema?.blocks) return undefined;
  return schema.blocks.find((b) => b.slug === blockType);
}
