/**
 * Field-level extraction from ts-morph object literals.
 *
 * Payload field definitions are TypeScript object literals like:
 *
 *   ```ts
 *   { name: 'heroTitle', type: 'text', required: true }
 *   ```
 *
 * `extractField()` reads one such literal and produces a normalised
 * `ExtractedField`. It is intentionally tolerant — unknown field types
 * collapse to `unknown`, deeply-conditional fields surface as a
 * diagnostic rather than crashing the parser.
 *
 * @module @codegen/parser/extract-field
 */

import {
  Node,
  SyntaxKind,
  type ArrayLiteralExpression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
} from 'ts-morph';
import type { ExtractedBlock, ExtractedField, ExtractedScalarField } from './types';

const SCALAR_TYPE_MAP: Readonly<Record<string, ExtractedScalarField['typeRef']>> = {
  text: 'string',
  textarea: 'string',
  email: 'string',
  richText: 'unknown',
  number: 'number',
  checkbox: 'boolean',
  date: 'string',
  code: 'string',
  point: 'unknown',
  ui: 'unknown',
  radio: 'string',
};

export function extractField(literal: ObjectLiteralExpression): ExtractedField | undefined {
  const type = readStringProperty(literal, 'type');
  if (type === undefined) return undefined;

  // Most fields carry a `name`. Structural containers (`tabs`,
  // `row`, `collapsible`) do not — they flatten into their parent.
  const STRUCTURAL_TYPES = new Set(['tabs', 'row', 'collapsible']);
  const name = readStringProperty(literal, 'name');
  if (name === undefined && !STRUCTURAL_TYPES.has(type)) return undefined;

  const required = readBooleanProperty(literal, 'required') ?? false;
  const localized = readBooleanProperty(literal, 'localized') ?? false;
  const base = { name: name ?? '__structural', required, localized };

  switch (type) {
    case 'array':
      return {
        ...base,
        kind: 'array',
        fields: extractNestedFields(literal),
      };
    case 'blocks':
      return {
        ...base,
        kind: 'blocks',
        blocks: extractBlocks(literal),
      };
    case 'group':
      return {
        ...base,
        kind: 'group',
        fields: extractNestedFields(literal),
      };
    case 'tabs':
    case 'row':
    case 'collapsible': {
      // Structural containers — flatten their inner fields up so they
      // appear at the parent's level (Payload does the same at runtime).
      const flattened = extractNestedFieldsFromStructural(literal);
      return {
        ...base,
        kind: 'group',
        fields: flattened,
      };
    }
    case 'relationship':
      return {
        ...base,
        kind: 'relationship',
        target: readRelationTarget(literal),
        hasMany: readBooleanProperty(literal, 'hasMany') ?? false,
      };
    case 'upload':
      return {
        ...base,
        kind: 'upload',
        target: readRelationTargetSingle(literal) ?? 'media',
      };
    case 'json':
      return { ...base, kind: 'json' };
    case 'select':
      return {
        ...base,
        kind: 'select',
        options: readSelectOptions(literal),
        hasMany: readBooleanProperty(literal, 'hasMany') ?? false,
      };
    default: {
      const typeRef = SCALAR_TYPE_MAP[type] ?? 'unknown';
      return { ...base, kind: 'scalar', typeRef };
    }
  }
}

function extractNestedFields(literal: ObjectLiteralExpression): readonly ExtractedField[] {
  const fieldsLiteral = readArrayProperty(literal, 'fields');
  if (!fieldsLiteral) return [];
  const out: ExtractedField[] = [];
  for (const element of fieldsLiteral.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const f = extractField(element);
    if (!f) continue;
    // Structural containers carry the magic `__structural` sentinel
    // name — splat their child fields into the parent instead of
    // surfacing them as a nameless property.
    if (f.kind === 'group' && f.name === '__structural') {
      out.push(...f.fields);
    } else {
      out.push(f);
    }
  }
  return out;
}

function extractNestedFieldsFromStructural(
  literal: ObjectLiteralExpression,
): readonly ExtractedField[] {
  // `tabs` is the awkward one — its inner shape is `tabs: [{ name, fields }, …]`
  // and each tab can either flatten via `name` or expose itself as a group.
  const tabsLiteral = readArrayProperty(literal, 'tabs');
  if (tabsLiteral) {
    const out: ExtractedField[] = [];
    for (const tabElement of tabsLiteral.getElements()) {
      if (!Node.isObjectLiteralExpression(tabElement)) continue;
      const tabName = readStringProperty(tabElement, 'name');
      const tabFields = extractNestedFields(tabElement);
      if (tabName !== undefined) {
        out.push({
          kind: 'group',
          name: tabName,
          required: false,
          localized: false,
          fields: tabFields,
        });
      } else {
        // Named-less tab — flatten its fields into the parent's surface.
        out.push(...tabFields);
      }
    }
    return out;
  }
  // `row` / `collapsible` — fields array sits directly on the literal.
  return extractNestedFields(literal);
}

function extractBlocks(literal: ObjectLiteralExpression): readonly ExtractedBlock[] {
  const blocksLiteral = readArrayProperty(literal, 'blocks');
  if (!blocksLiteral) return [];
  const out: ExtractedBlock[] = [];
  for (const element of blocksLiteral.getElements()) {
    if (!Node.isObjectLiteralExpression(element)) continue;
    const slug = readStringProperty(element, 'slug');
    if (slug === undefined) continue;
    out.push({
      slug,
      typeName: toPascalCase(slug),
      fields: extractNestedFields(element),
    });
  }
  return out;
}

function readRelationTarget(literal: ObjectLiteralExpression): string | readonly string[] {
  const property = literal.getProperty('relationTo');
  if (!property || !Node.isPropertyAssignment(property)) return 'unknown';
  const initialiser = property.getInitializer();
  if (initialiser && Node.isStringLiteral(initialiser)) return initialiser.getLiteralValue();
  if (initialiser && Node.isArrayLiteralExpression(initialiser)) {
    return initialiser
      .getElements()
      .filter(Node.isStringLiteral)
      .map((el) => el.getLiteralValue());
  }
  return 'unknown';
}

function readRelationTargetSingle(literal: ObjectLiteralExpression): string | undefined {
  const target = readRelationTarget(literal);
  if (typeof target === 'string') return target;
  return target[0];
}

function readSelectOptions(literal: ObjectLiteralExpression): readonly string[] {
  const optionsLiteral = readArrayProperty(literal, 'options');
  if (!optionsLiteral) return [];
  const out: string[] = [];
  for (const element of optionsLiteral.getElements()) {
    if (Node.isStringLiteral(element)) {
      out.push(element.getLiteralValue());
    } else if (Node.isObjectLiteralExpression(element)) {
      const value = readStringProperty(element, 'value');
      if (value !== undefined) out.push(value);
    }
  }
  return out;
}

function readStringProperty(literal: ObjectLiteralExpression, name: string): string | undefined {
  const property = literal.getProperty(name);
  if (!property || !isPropertyAssignment(property)) return undefined;
  const initialiser = property.getInitializer();
  if (initialiser && Node.isStringLiteral(initialiser)) return initialiser.getLiteralValue();
  if (initialiser && Node.isNoSubstitutionTemplateLiteral(initialiser)) {
    return initialiser.getLiteralValue();
  }
  return undefined;
}

function readBooleanProperty(literal: ObjectLiteralExpression, name: string): boolean | undefined {
  const property = literal.getProperty(name);
  if (!property || !isPropertyAssignment(property)) return undefined;
  const initialiser = property.getInitializer();
  if (!initialiser) return undefined;
  if (initialiser.getKind() === SyntaxKind.TrueKeyword) return true;
  if (initialiser.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function readArrayProperty(
  literal: ObjectLiteralExpression,
  name: string,
): ArrayLiteralExpression | undefined {
  const property = literal.getProperty(name);
  if (!property || !isPropertyAssignment(property)) return undefined;
  const initialiser = property.getInitializer();
  if (initialiser && Node.isArrayLiteralExpression(initialiser)) return initialiser;
  return undefined;
}

function isPropertyAssignment(node: Node): node is PropertyAssignment {
  return Node.isPropertyAssignment(node);
}

function toPascalCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export { toPascalCase };
