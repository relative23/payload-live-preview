/**
 * Schema-level extraction: open `payload.config.ts`, find every
 * collection and global definition, walk into them.
 *
 * The extractor is deliberately lenient. Payload configurations are
 * full TypeScript programs — a strict parser would have to model
 * conditional types, factory functions, plugin closures. Instead we
 * recognise the *common* shapes (object literal, identifier
 * referencing an imported literal, default export from a sibling
 * file) and emit a diagnostic for anything we can't unwrap.
 *
 * @module @codegen/parser/extract-schema
 */

import {
  Node,
  Project,
  SyntaxKind,
  type ArrayLiteralExpression,
  type Identifier,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';
import type { ExtractedField, ExtractedSchema, ExtractedSlug } from './types';
import { extractField, toPascalCase } from './extract-field';

export interface ExtractSchemaOptions {
  /** Absolute or relative path to `payload.config.ts`. */
  readonly configPath: string;
  /** When provided, used instead of constructing a fresh ts-morph project. */
  readonly project?: Project;
  /**
   * Optional path to a `tsconfig.json`. When set, ts-morph loads the
   * project's module-resolution configuration so cross-file imports
   * (Homepage from './globals') can be followed.
   */
  readonly tsConfigFilePath?: string;
}

export function extractSchema(options: ExtractSchemaOptions): ExtractedSchema {
  const project =
    options.project ??
    new Project(
      options.tsConfigFilePath !== undefined
        ? { tsConfigFilePath: options.tsConfigFilePath }
        : { skipAddingFilesFromTsConfig: true },
    );
  const sourceFile = project.addSourceFileAtPathIfExists(options.configPath);
  if (!sourceFile) {
    return {
      globals: [],
      collections: [],
      diagnostics: [`Could not open ${options.configPath}`],
    };
  }
  // Pull in every transitively-imported file so cross-file identifier
  // resolution (e.g., `import { Homepage } from './globals'`) can
  // reach the underlying object literal.
  project.resolveSourceFileDependencies();
  const diagnostics: string[] = [];

  const configLiteral = findConfigLiteral(sourceFile, diagnostics);
  if (!configLiteral) {
    return {
      globals: [],
      collections: [],
      diagnostics: [
        ...diagnostics,
        'Could not locate a buildConfig({...}) call or `export default {...}` in the config file.',
      ],
    };
  }

  const globals = extractSlugList(configLiteral, 'globals', diagnostics);
  const collections = extractSlugList(configLiteral, 'collections', diagnostics);

  return { globals, collections, diagnostics };
}

function findConfigLiteral(
  sourceFile: SourceFile,
  diagnostics: string[],
): ObjectLiteralExpression | undefined {
  const defaultExport = sourceFile
    .getExportSymbols()
    .find((sym) => sym.getName() === 'default');
  if (!defaultExport) {
    diagnostics.push('payload.config.ts has no default export.');
    return undefined;
  }
  const declarations = defaultExport.getDeclarations();
  for (const decl of declarations) {
    const candidate = unwrapToObjectLiteral(decl);
    if (candidate) return candidate;
  }
  // Fallback: scan the source file for the first `buildConfig({...})` call.
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && expr.getText() === 'buildConfig') {
      const arg = call.getArguments()[0];
      if (arg && Node.isObjectLiteralExpression(arg)) return arg;
    }
  }
  return undefined;
}

function unwrapToObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  if (Node.isExportAssignment(node)) {
    return unwrapExpression(node.getExpression());
  }
  if (Node.isVariableDeclaration(node)) {
    const initialiser = node.getInitializer();
    if (initialiser) return unwrapExpression(initialiser);
  }
  return undefined;
}

function unwrapExpression(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isObjectLiteralExpression(node)) return node;
  if (Node.isCallExpression(node)) {
    // `buildConfig({...})` or `defineConfig({...})` — first arg.
    const arg = node.getArguments()[0];
    if (arg && Node.isObjectLiteralExpression(arg)) return arg;
  }
  if (Node.isAsExpression(node)) {
    return unwrapExpression(node.getExpression());
  }
  if (Node.isSatisfiesExpression(node)) {
    return unwrapExpression(node.getExpression());
  }
  if (Node.isIdentifier(node)) {
    return resolveIdentifierToObjectLiteral(node);
  }
  return undefined;
}

function resolveIdentifierToObjectLiteral(
  identifier: Identifier,
): ObjectLiteralExpression | undefined {
  for (const decl of identifier.getDefinitionNodes()) {
    const result = unwrapToObjectLiteral(decl);
    if (result) return result;
  }
  return undefined;
}

function extractSlugList(
  configLiteral: ObjectLiteralExpression,
  key: 'globals' | 'collections',
  diagnostics: string[],
): readonly ExtractedSlug[] {
  const property = configLiteral.getProperty(key);
  if (!property) return [];
  if (!Node.isPropertyAssignment(property)) return [];
  const initialiser = property.getInitializer();
  if (!initialiser) return [];
  const array = resolveToArrayLiteral(initialiser);
  if (!array) return [];
  return extractEntries(array, diagnostics);
}

function extractEntries(
  array: ArrayLiteralExpression,
  diagnostics: string[],
): readonly ExtractedSlug[] {
  const out: ExtractedSlug[] = [];
  for (const element of array.getElements()) {
    // Handle `...someArray` spreads — common pattern in real Payload
    // configs that split globals/collections into named buckets.
    if (Node.isSpreadElement(element)) {
      const expandedArray = resolveToArrayLiteral(element.getExpression());
      if (!expandedArray) {
        diagnostics.push(
          `Could not resolve spread "${element.getText().slice(0, 80)}" to an array literal.`,
        );
        continue;
      }
      out.push(...extractEntries(expandedArray, diagnostics));
      continue;
    }
    const literal = resolveToObjectLiteral(element);
    if (!literal) {
      diagnostics.push(
        `Could not resolve config entry "${element.getText().slice(0, 80)}" to an object literal.`,
      );
      continue;
    }
    const slug = readStringProperty(literal, 'slug');
    if (slug === undefined) {
      diagnostics.push(`Skipping a config entry — no string \`slug\` field found.`);
      continue;
    }
    out.push({
      slug,
      typeName: toPascalCase(slug),
      fields: extractFieldList(literal),
    });
  }
  return out;
}

function extractFieldList(
  configEntry: ObjectLiteralExpression,
): readonly ExtractedField[] {
  const fieldsProperty = configEntry.getProperty('fields');
  if (!fieldsProperty || !Node.isPropertyAssignment(fieldsProperty)) return [];
  const initialiser = fieldsProperty.getInitializer();
  if (!initialiser || !Node.isArrayLiteralExpression(initialiser)) return [];
  const out: ExtractedField[] = [];
  for (const element of initialiser.getElements()) {
    // Allow spread elements for users who split fields into reusable
    // arrays (e.g., `...commonSeoFields`).
    if (Node.isSpreadElement(element)) {
      const expanded = resolveToArrayLiteral(element.getExpression());
      if (!expanded) continue;
      for (const inner of expanded.getElements()) {
        const literal = resolveToObjectLiteral(inner);
        if (!literal) continue;
        const field = extractField(literal);
        if (!field) continue;
        if (field.kind === 'group' && field.name === '__structural') {
          out.push(...field.fields);
        } else {
          out.push(field);
        }
      }
      continue;
    }
    const literal = resolveToObjectLiteral(element);
    if (!literal) continue;
    const field = extractField(literal);
    if (!field) continue;
    if (field.kind === 'group' && field.name === '__structural') {
      out.push(...field.fields);
    } else {
      out.push(field);
    }
  }
  return out;
}

function resolveToObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) return node;
  if (Node.isIdentifier(node)) return resolveIdentifierToObjectLiteral(node);
  if (Node.isAsExpression(node)) return resolveToObjectLiteral(node.getExpression());
  if (Node.isSatisfiesExpression(node)) return resolveToObjectLiteral(node.getExpression());
  if (Node.isCallExpression(node)) {
    const arg = node.getArguments()[0];
    if (arg) return resolveToObjectLiteral(arg);
  }
  return undefined;
}

function resolveToArrayLiteral(node: Node): ArrayLiteralExpression | undefined {
  if (Node.isArrayLiteralExpression(node)) return node;
  if (Node.isAsExpression(node)) return resolveToArrayLiteral(node.getExpression());
  if (Node.isSatisfiesExpression(node)) return resolveToArrayLiteral(node.getExpression());
  if (Node.isIdentifier(node)) {
    for (const decl of node.getDefinitionNodes()) {
      if (Node.isVariableDeclaration(decl)) {
        const initialiser = decl.getInitializer();
        if (initialiser) {
          const resolved = resolveToArrayLiteral(initialiser);
          if (resolved) return resolved;
        }
      }
    }
  }
  return undefined;
}

function readStringProperty(literal: ObjectLiteralExpression, name: string): string | undefined {
  const property = literal.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) return undefined;
  const initialiser = property.getInitializer();
  if (initialiser && Node.isStringLiteral(initialiser)) return initialiser.getLiteralValue();
  return undefined;
}
