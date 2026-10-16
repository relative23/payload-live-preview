/**
 * The options literals a script hands to the package: an object literal passed
 * to a function or class the script binds from it, and a `const` object literal
 * such a call takes by name or spreads into its own. The option codemods rename
 * or expand keys there (ADR 0026); anything else they cannot see is left to the
 * development warning the package gives at run time.
 */
import type { JsxAttribute, Node, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { loadTsMorph, packageBindings, propertyKey, referencesTo } from './ast';

/** Adapter options carry the request rows too; the root, `/core` and `/client` take runtime options. */
export type OptionsKind = 'adapter' | 'runtime';

/** @internal */
export const ADAPTER_ENTRIES: ReadonlySet<string> = new Set(
  ['astro', 'nextjs', 'sveltekit', 'nuxt', 'nuxt-module'].map(
    (entry) => `payload-live-preview/${entry}`,
  ),
);

/** One call that uses a literal: the literal the call passes, which spreads the shared one or is it. */
export interface OptionsUse {
  readonly kind: OptionsKind;
  readonly outer: ObjectLiteralExpression;
  /** The index of the spread in `outer` that brings the shared literal in; absent when `outer` is it. */
  readonly at?: number;
}

/** Every literal the package receives, with the calls that give it. */
export function optionLiterals(
  script: SourceFile,
): ReadonlyMap<ObjectLiteralExpression, readonly OptionsUse[]> {
  const { Node } = loadTsMorph();
  const found = new Map<ObjectLiteralExpression, OptionsUse[]>();
  const record = (literal: ObjectLiteralExpression, use: OptionsUse): void => {
    const uses = found.get(literal) ?? [];
    if (
      !uses.some(
        (known) => known.outer === use.outer && known.at === use.at && known.kind === use.kind,
      )
    ) {
      uses.push(use);
    }
    found.set(literal, uses);
  };
  const visit = (literal: ObjectLiteralExpression, kind: OptionsKind): void => {
    record(literal, { kind, outer: literal });
    literal.getProperties().forEach((property, at) => {
      if (!Node.isSpreadAssignment(property)) return;
      const shared = constLiteral(property.getExpression());
      if (shared !== undefined) record(shared, { kind, outer: literal, at });
    });
  };
  for (const binding of packageBindings(script)) {
    const kind: OptionsKind = ADAPTER_ENTRIES.has(binding.specifier) ? 'adapter' : 'runtime';
    for (const reference of referencesTo(script, binding)) {
      const call = reference.node.getParent();
      if (reference.kind !== 'reference') continue;
      if (!Node.isCallExpression(call) && !Node.isNewExpression(call)) continue;
      if (call.getExpression() !== reference.node) continue;
      for (const argument of call.getArguments()) {
        const inner = unwrap(argument);
        const literal = Node.isObjectLiteralExpression(inner) ? inner : constLiteral(inner);
        if (literal !== undefined) visit(literal, kind);
      }
    }
  }
  return found;
}

/** `name="…"` or `name={…}` on a JSX element whose tag the script binds from the package. */
export function packageJsxAttributes(script: SourceFile, name: string): readonly JsxAttribute[] {
  const { Node, SyntaxKind } = loadTsMorph();
  const tags = new Set(packageBindings(script).map((binding) => binding.local));
  return script.getDescendantsOfKind(SyntaxKind.JsxAttribute).filter((attribute) => {
    const element = attribute.getParent().getParent();
    const isTag = Node.isJsxOpeningElement(element) || Node.isJsxSelfClosingElement(element);
    return (
      isTag &&
      tags.has(element.getTagNameNode().getText()) &&
      attribute.getNameNode().getText() === name
    );
  });
}

/** The member spelled `key`, or `undefined`. */
export function memberNamed(literal: ObjectLiteralExpression, key: string): Node | undefined {
  return literal.getProperties().find((property) => propertyKey(property) === key);
}

/** The literal a `const` declares, seen through `as const`, `satisfies` and parentheses. */
function constLiteral(node: Node): ObjectLiteralExpression | undefined {
  const { Node, VariableDeclarationKind } = loadTsMorph();
  const target = unwrap(node);
  if (!Node.isIdentifier(target)) return undefined;
  for (const declaration of target.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    if (
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      continue;
    }
    const initializer = declaration.getInitializer();
    const literal = initializer === undefined ? undefined : unwrap(initializer);
    if (literal !== undefined && Node.isObjectLiteralExpression(literal)) return literal;
  }
  return undefined;
}

function unwrap(node: Node): Node {
  const { Node } = loadTsMorph();
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
