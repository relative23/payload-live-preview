/**
 * Field-level extraction: one Payload field literal → an `ExtractedField`,
 * recursing into groups, arrays, tabs and blocks.
 */
import { Node, type ArrayLiteralExpression, type ObjectLiteralExpression } from 'ts-morph';
import { toPascalCase } from './names';
import {
  expandElements,
  hasProperty,
  readArrayProperty,
  readBooleanProperty,
  readRelationTarget,
  readStringProperty,
  reportSkip,
  resolveToObjectLiteral,
  type ExtractContext,
} from './resolve';
import type { ExtractedBlock, ExtractedField, ExtractedScalarField } from './types';

/** Name of an unnamed structural container; its fields flatten into the parent. */
export const STRUCTURAL_SENTINEL = '__structural';
const STRUCTURAL_TYPES = new Set(['tabs', 'row', 'collapsible']);
const SCALAR_TYPE_MAP: Readonly<Record<string, ExtractedScalarField['typeRef']>> = {
  text: 'string',
  textarea: 'string',
  email: 'string',
  richText: 'unknown',
  number: 'number',
  checkbox: 'boolean',
  date: 'string',
  code: 'string',
  point: '[number, number]',
};
const HAS_MANY_SCALARS = new Set(['text', 'number']);

/** Every field in `array`, spreads expanded and structural containers flattened. */
export function extractFields(
  array: ArrayLiteralExpression,
  context: ExtractContext,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const element of expandElements(array, context)) {
    const literal = resolveToObjectLiteral(element);
    if (literal === undefined) {
      reportSkip(context, element, 'could not resolve the field to an object literal');
      continue;
    }
    const field = extractField(literal, context);
    if (field === undefined) continue;
    if (field.kind === 'group' && field.name === STRUCTURAL_SENTINEL) out.push(...field.fields);
    else out.push(field);
  }
  return out;
}

function nestedFields(literal: ObjectLiteralExpression, context: ExtractContext): ExtractedField[] {
  const array = readArrayProperty(literal, 'fields');
  if (array !== undefined) return extractFields(array, context);
  reportSkip(
    context,
    literal,
    hasProperty(literal, 'fields')
      ? 'its `fields` could not be resolved to an array literal'
      : 'it has no `fields`',
  );
  return [];
}

function extractTabs(literal: ObjectLiteralExpression, context: ExtractContext): ExtractedField[] {
  const tabs = readArrayProperty(literal, 'tabs');
  if (tabs === undefined) {
    reportSkip(context, literal, 'its `tabs` could not be resolved to an array literal');
    return [];
  }
  const out: ExtractedField[] = [];
  for (const element of expandElements(tabs, context)) {
    const tab = resolveToObjectLiteral(element);
    if (tab === undefined) {
      reportSkip(context, element, 'could not resolve the tab to an object literal');
      continue;
    }
    const name = readStringProperty(tab, 'name');
    const fields = nestedFields(tab, context);
    if (name === undefined) out.push(...fields);
    else out.push({ kind: 'group', name, required: false, localized: false, fields });
  }
  return out;
}

function extractBlocks(
  literal: ObjectLiteralExpression,
  context: ExtractContext,
): ExtractedBlock[] {
  const blocks = readArrayProperty(literal, 'blocks');
  if (blocks === undefined) {
    reportSkip(context, literal, 'its `blocks` could not be resolved to an array literal');
    return [];
  }
  const out: ExtractedBlock[] = [];
  for (const element of expandElements(blocks, context)) {
    const block = resolveToObjectLiteral(element);
    if (block === undefined) {
      reportSkip(context, element, 'could not resolve the block to an object literal');
      continue;
    }
    const slug = readStringProperty(block, 'slug');
    if (slug === undefined) {
      reportSkip(context, element, 'a block needs a string `slug`');
      continue;
    }
    out.push({ slug, typeName: toPascalCase(slug), fields: nestedFields(block, context) });
  }
  return out;
}

function readOptions(literal: ObjectLiteralExpression, context: ExtractContext): string[] {
  const options = readArrayProperty(literal, 'options');
  if (options === undefined) {
    reportSkip(context, literal, 'its `options` could not be resolved to an array literal');
    return [];
  }
  const out: string[] = [];
  for (const element of expandElements(options, context)) {
    if (Node.isStringLiteral(element)) {
      out.push(element.getLiteralValue());
      continue;
    }
    const option = resolveToObjectLiteral(element);
    const value = option === undefined ? undefined : readStringProperty(option, 'value');
    if (value === undefined) reportSkip(context, element, 'an option needs a string or a `value`');
    else out.push(value);
  }
  return out;
}

/** One field, or `undefined` for a `ui` field (nothing to type) and for shapes reported as skipped. */
export function extractField(
  literal: ObjectLiteralExpression,
  context: ExtractContext,
): ExtractedField | undefined {
  const type = readStringProperty(literal, 'type');
  if (type === undefined) {
    reportSkip(context, literal, 'it has no string `type`');
    return undefined;
  }
  if (type === 'ui') return undefined;
  const name = readStringProperty(literal, 'name');
  if (name === undefined && !STRUCTURAL_TYPES.has(type)) {
    reportSkip(context, literal, `a ${type} field needs a string \`name\``);
    return undefined;
  }
  const base = {
    name: name ?? STRUCTURAL_SENTINEL,
    required: readBooleanProperty(literal, 'required') ?? false,
    localized: readBooleanProperty(literal, 'localized') ?? false,
  };
  const hasMany = readBooleanProperty(literal, 'hasMany') ?? false;
  switch (type) {
    case 'array':
      return { ...base, kind: 'array', fields: nestedFields(literal, context) };
    case 'group':
    case 'row':
    case 'collapsible':
      return { ...base, kind: 'group', fields: nestedFields(literal, context) };
    case 'tabs':
      return { ...base, kind: 'group', fields: extractTabs(literal, context) };
    case 'blocks':
      return { ...base, kind: 'blocks', blocks: extractBlocks(literal, context) };
    case 'relationship':
      return { ...base, kind: 'relationship', target: readRelationTarget(literal), hasMany };
    case 'upload': {
      const target = readRelationTarget(literal);
      return {
        ...base,
        kind: 'upload',
        target: (typeof target === 'string' ? target : target[0]) ?? 'media',
        hasMany,
      };
    }
    case 'json':
      return { ...base, kind: 'json' };
    case 'select':
    case 'radio':
      return {
        ...base,
        kind: 'select',
        options: readOptions(literal, context),
        hasMany: type === 'select' && hasMany,
      };
    default:
      return {
        ...base,
        kind: 'scalar',
        typeRef: SCALAR_TYPE_MAP[type] ?? 'unknown',
        hasMany: HAS_MANY_SCALARS.has(type) && hasMany,
      };
  }
}
