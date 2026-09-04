/**
 * Resolving the shapes a Payload config takes — literals, identifiers,
 * imports, wrappers, spreads — to the literals the extractors read. Every
 * shape that cannot be resolved becomes a diagnostic, never a silent gap.
 */
import {
  Node,
  type ArrayLiteralExpression,
  type Identifier,
  type ObjectLiteralExpression,
} from 'ts-morph';

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
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/** An import or re-export binds a name but holds no value; the value is in the module it names. */
function followAlias(declaration: Node): readonly Node[] {
  const isAlias =
    Node.isImportSpecifier(declaration) ||
    Node.isImportClause(declaration) ||
    Node.isNamespaceImport(declaration) ||
    Node.isExportSpecifier(declaration);
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
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return declaration.getInitializer();
  }
  if (Node.isExportAssignment(declaration)) return declaration.getExpression();
  if (Node.isShorthandPropertyAssignment(declaration)) return declaration.getNameNode();
  return undefined;
}

/** The value of a property, treating `{ fields }` shorthand as a reference to resolve. */
export function propertyValue(literal: ObjectLiteralExpression, name: string): Node | undefined {
  const property = literal.getProperty(name);
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
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
  if (Node.isObjectLiteralExpression(target)) return target;
  // `buildConfig({...})`, `defineConfig({...})`: the literal is the first argument.
  if (Node.isCallExpression(target)) return resolveToObjectLiteral(target.getArguments()[0], seen);
  if (Node.isIdentifier(target)) {
    for (const declaration of definitionsOf(target)) {
      const resolved = resolveToObjectLiteral(valueOf(declaration), seen);
      if (resolved !== undefined) return resolved;
    }
  }
  if (Node.isPropertyAccessExpression(target)) {
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
  if (Node.isArrayLiteralExpression(target)) return target;
  if (Node.isIdentifier(target)) {
    for (const declaration of definitionsOf(target)) {
      const resolved = resolveToArrayLiteral(valueOf(declaration), seen);
      if (resolved !== undefined) return resolved;
    }
  }
  if (Node.isPropertyAccessExpression(target)) {
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
    if (!Node.isSpreadElement(element)) {
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
  if (Node.isStringLiteral(target) || Node.isNoSubstitutionTemplateLiteral(target)) {
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
  if (Node.isTrueLiteral(target)) return true;
  if (Node.isFalseLiteral(target)) return false;
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
  if (Node.isStringLiteral(target)) return target.getLiteralValue();
  const array = resolveToArrayLiteral(target);
  if (array === undefined) return 'unknown';
  return array
    .getElements()
    .map(unwrap)
    .filter((element) => Node.isStringLiteral(element))
    .map((element) => element.getLiteralValue());
}
