/**
 * Which schema fields a binding can address, spelled the way the runtime
 * resolves them. Paths follow `@schema/walker` exactly — bindings are matched
 * against that rule at runtime, so any other spelling would be wrong here.
 */

import type { ExtractedField, ExtractedSchema, ExtractedSlug } from './parser/types';

/** Sentinel the parser gives an unnamed structural container. */
const STRUCTURAL_SENTINEL = '__structural';

/** One addressable field, spelled the way a binding must spell it. */
export interface PreviewInventoryField {
  /** Runtime binding path, e.g. `hero.title` or `slides.*.caption`. */
  readonly path: string;
  /** Extracted field kind: `scalar`, `array`, `blocks`, `group`, … */
  readonly kind: ExtractedField['kind'];
  readonly localized: boolean;
  readonly required: boolean;
}

export interface PreviewInventoryEntry {
  readonly slug: string;
  readonly typeName: string;
  readonly fields: readonly PreviewInventoryField[];
}

export interface PreviewInventory {
  readonly globals: readonly PreviewInventoryEntry[];
  readonly collections: readonly PreviewInventoryEntry[];
}

function collect(
  fields: readonly ExtractedField[],
  basePath: string,
  out: PreviewInventoryField[],
): void {
  for (const field of fields) {
    // No segment, but its children still belong to the parent's surface.
    if (field.kind === 'group' && field.name === STRUCTURAL_SENTINEL) {
      collect(field.fields, basePath, out);
      continue;
    }
    const path = basePath === '' ? field.name : `${basePath}.${field.name}`;
    out.push({
      path,
      kind: field.kind,
      localized: field.localized,
      required: field.required,
    });
    if (field.kind === 'group') {
      collect(field.fields, path, out);
    } else if (field.kind === 'array') {
      collect(field.fields, `${path}.*`, out);
    } else if (field.kind === 'blocks') {
      for (const block of field.blocks) {
        collect(block.fields, `${path}.*.${block.slug}`, out);
      }
    }
  }
}

function entry(slug: ExtractedSlug): PreviewInventoryEntry {
  const fields: PreviewInventoryField[] = [];
  collect(slug.fields, '', fields);
  return { slug: slug.slug, typeName: slug.typeName, fields };
}

/** Flatten an extracted schema into every path a binding may address. */
export function buildPreviewInventory(schema: ExtractedSchema): PreviewInventory {
  return {
    globals: schema.globals.map(entry),
    collections: schema.collections.map(entry),
  };
}

/** A binding found in consumer markup, however that consumer found it. */
export interface PreviewBindingReference {
  readonly kind: 'global' | 'collection';
  readonly slug: string;
  readonly path: string;
  /** Free-form origin for the diagnostic, e.g. `Hero.astro:42`. */
  readonly source?: string;
}

export interface PreviewCoverageOptions {
  /** Also report schema fields no binding addresses; off, since a page may render a subset. */
  readonly reportUnbound?: boolean;
}

/** Cross-check bindings the consumer extracted against the inventory. */
export function checkPreviewBindings(
  inventory: PreviewInventory,
  bindings: readonly PreviewBindingReference[],
  options: PreviewCoverageOptions = {},
): readonly string[] {
  const diagnostics: string[] = [];
  const byKey = new Map<string, ReadonlySet<string>>();
  for (const [kind, entries] of [
    ['global', inventory.globals],
    ['collection', inventory.collections],
  ] as const) {
    for (const item of entries) {
      byKey.set(`${kind}:${item.slug}`, new Set(item.fields.map((f) => f.path)));
    }
  }

  const seen = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const key = `${binding.kind}:${binding.slug}`;
    const where = binding.source === undefined ? '' : ` (${binding.source})`;
    const paths = byKey.get(key);
    if (paths === undefined) {
      diagnostics.push(`unknown ${binding.kind} "${binding.slug}"${where}`);
      continue;
    }
    if (!paths.has(binding.path)) {
      diagnostics.push(`${key} has no field "${binding.path}"${where}`);
      continue;
    }
    let bound = seen.get(key);
    if (bound === undefined) {
      bound = new Set<string>();
      seen.set(key, bound);
    }
    bound.add(binding.path);
  }

  if (options.reportUnbound === true) {
    for (const [key, paths] of byKey) {
      const bound = seen.get(key) ?? new Set<string>();
      for (const path of paths) {
        if (!bound.has(path)) diagnostics.push(`${key} field "${path}" is never bound`);
      }
    }
  }

  return diagnostics;
}
