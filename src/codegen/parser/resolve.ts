/**
 * Resolving the shapes a Payload config takes — literals, identifiers,
 * imports, wrappers, spreads — to the literals the extractors read. Every
 * shape that cannot be resolved becomes a diagnostic, never a silent gap.
 */
import { createRequire } from 'node:module';
import type * as TsMorphModule from 'ts-morph';
import type { ArrayLiteralExpression, Identifier, Node, ObjectLiteralExpression } from 'ts-morph';

let tsMorph: typeof TsMorphModule | undefined;

/**
 * ts-morph on first use. It is an optional peer because it reads a Payload
 * config, and nothing else here needs a TypeScript compiler: an entry that only
 * prints its help, or refuses a usage error, must load without it. A static
 * import would not allow that — esbuild hoists an external import to the top of
 * the bundle even out of a dynamically imported module, so the binary would
 * resolve the peer before parsing its first flag. `pll migrate` loads it the
 * same way (src/migrate/ast.ts).
 */
export function loadTsMorph(): typeof TsMorphModule {
  if (tsMorph === undefined) {
    try {
      tsMorph = createRequire(import.meta.url)('ts-morph') as typeof TsMorphModule;
    } catch (error) {
      throw new Error('pll-codegen needs ts-morph: npm install --save-dev ts-morph', {
        cause: error,
      });
    }
  }
  return tsMorph;
}

/** The `Node` type guards, which every extractor reaches for. */
export function tsNode(): typeof TsMorphModule.Node {
  return loadTsMorph().Node;
}

export interface ExtractContext {
  readonly diagnostics: string[];
}

function where(node: Node): string {
  return `${node.getSourceFile().getBaseName()}:${String(node.getStartLineNumber())}`;
}

function snippet(node: Node): string {
  const text = node.getText().replace(/\s+/gu, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export function reportSkip(context: ExtractContext, node: Node, why: string): void {
  context.diagnostics.push(`Skipped "${snippet(node)}" at ${where(node)}: ${why}.`);
}

function unwrap(node: Node): Node {
  let current = node;
  while (
    tsNode().isParenthesizedExpression(current) ||
    tsNode().isAsExpression(current) ||
    tsNode().isSatisfiesExpression(current) ||
    tsNode().isNonNullExpression(current) ||
    tsNode().isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** An import or re-export binds a name but holds no value; the value is in the module it names. */
function followAlias(declaration: Node): readonly Node[] {
  const isAlias =
    tsNode().isImportSpecifier(declaration) ||
    tsNode().isImportClause(declaration) ||
    tsNode().isNamespaceImport(declaration) ||
    tsNode().isExportSpecifier(declaration);
  if (!isAlias) return [declaration];
  const aliased = declaration.getSymbol()?.getAliasedSymbol();
  return aliased?.getDeclarations() ?? [declaration];
}

/** Follows imports through the language service; the binder is the fallback for what it cannot see. */
function definitionsOf(identifier: Identifier): readonly Node[] {
  const definitions = identifier.getDefinitionNodes();
  const found =
    definitions.length > 0 ? definitions : (identifier.getSymbol()?.getDeclarations() ?? []);
  return found.flatMap(followAlias);
}

function valueOf(declaration: Node): Node | undefined {
  if (tsNode().isVariableDeclaration(declaration) || tsNode().isPropertyAssignment(declaration)) {
    return declaration.getInitializer();
  }
  if (tsNode().isExportAssignment(declaration)) return declaration.getExpression();
  if (tsNode().isShorthandPropertyAssignment(declaration)) return declaration.getNameNode();
  return undefined;
}

/** The value of a property, treating `{ fields }` shorthand as a reference to resolve. */
export function propertyValue(literal: ObjectLiteralExpression, name: string): Node | undefined {
  const property = literal.getProperty(name);
  if (property === undefined) return undefined;
  if (tsNode().isPropertyAssignment(property)) return property.getInitializer();
  if (tsNode().isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
}

export function hasProperty(literal: ObjectLiteralExpression, name: string): boolean {
  return literal.getProperty(name) !== undefined;
}

export function resolveToObjectLiteral(
  node: Node | undefined,
  seen = new Set<Node>(),
): ObjectLiteralExpression | undefined {
  if (node === undefined || seen.has(node)) return undefined;
  seen.add(node);
  const target = unwrap(node);
  if (tsNode().isObjectLiteralExpression(target)) return target;
  // `buildConfig({...})`, `defineConfig({...})`: the literal is the first argument.
  if (tsNode().isCallExpression(target)) {
    return resolveToObjectLiteral(target.getArguments()[0], seen);
  }
  if (tsNode().isIdentifier(target)) {
    for (const declaration of definitionsOf(target)) {
      const resolved = resolveToObjectLiteral(valueOf(declaration), seen);
      if (resolved !== undefined) return resolved;
    }
  }
  if (tsNode().isPropertyAccessExpression(target)) {
    const owner = resolveToObjectLiteral(target.getExpression(), seen);
    if (owner !== undefined) {
      return resolveToObjectLiteral(propertyValue(owner, target.getName()), seen);
    }
  }
  return undefined;
}

export function resolveToArrayLiteral(
  node: Node | undefined,
  seen = new Set<Node>(),
): ArrayLiteralExpression | undefined {
  if (node === undefined || seen.has(node)) return undefined;
  seen.add(node);
  const target = unwrap(node);
  if (tsNode().isArrayLiteralExpression(target)) return target;
  if (tsNode().isIdentifier(target)) {
    for (const declaration of definitionsOf(target)) {
      const resolved = resolveToArrayLiteral(valueOf(declaration), seen);
      if (resolved !== undefined) return resolved;
    }
  }
  if (tsNode().isPropertyAccessExpression(target)) {
    const owner = resolveToObjectLiteral(target.getExpression(), seen);
    if (owner !== undefined) {
      return resolveToArrayLiteral(propertyValue(owner, target.getName()), seen);
    }
  }
  return undefined;
}

/** The elements of an array with every spread expanded; a spread that cannot be resolved is reported and dropped. */
export function expandElements(array: ArrayLiteralExpression, context: ExtractContext): Node[] {
  const out: Node[] = [];
  for (const element of array.getElements()) {
    if (!tsNode().isSpreadElement(element)) {
      out.push(element);
      continue;
    }
    const expanded = resolveToArrayLiteral(element.getExpression());
    if (expanded === undefined) {
      reportSkip(
        context,
        element,
        'could not resolve the spread to an array literal, so its entries are missing',
      );
      continue;
    }
    out.push(...expandElements(expanded, context));
  }
  return out;
}

export function readStringProperty(
  literal: ObjectLiteralExpression,
  name: string,
): string | undefined {
  const value = propertyValue(literal, name);
  if (value === undefined) return undefined;
  const target = unwrap(value);
  if (tsNode().isStringLiteral(target) || tsNode().isNoSubstitutionTemplateLiteral(target)) {
    return target.getLiteralValue();
  }
  return undefined;
}

export function readBooleanProperty(
  literal: ObjectLiteralExpression,
  name: string,
): boolean | undefined {
  const value = propertyValue(literal, name);
  if (value === undefined) return undefined;
  const target = unwrap(value);
  if (tsNode().isTrueLiteral(target)) return true;
  if (tsNode().isFalseLiteral(target)) return false;
  return undefined;
}

export function readArrayProperty(
  literal: ObjectLiteralExpression,
  name: string,
): ArrayLiteralExpression | undefined {
  return resolveToArrayLiteral(propertyValue(literal, name));
}

/** `relationTo`: one slug, several, or `'unknown'` when it is not a literal. */
export function readRelationTarget(literal: ObjectLiteralExpression): string | readonly string[] {
  const value = propertyValue(literal, 'relationTo');
  if (value === undefined) return 'unknown';
  const target = unwrap(value);
  if (tsNode().isStringLiteral(target)) return target.getLiteralValue();
  const array = resolveToArrayLiteral(target);
  if (array === undefined) return 'unknown';
  return array
    .getElements()
    .map(unwrap)
    .filter((element) => tsNode().isStringLiteral(element))
    .map((element) => element.getLiteralValue());
}
