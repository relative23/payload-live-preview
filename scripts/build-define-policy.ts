/**
 * esbuild folds a `define` only where the identifier is read at the branch it
 * guards. Copying it into a `const` first leaves a live variable, the branch
 * survives minification, and the guarded code ships — silently, because the
 * source still reads as if it were compiled out.
 */

import { Node, Project, SyntaxKind } from 'ts-morph';

/** Identifiers substituted by `scripts/build-runtime.ts`'s esbuild `define`. */
export const BUILD_DEFINES = ['__INLINE_BUILD__'] as const;

export interface BuildDefineViolation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const DEFINES = new Set<string>(BUILD_DEFINES);

/** The condition of an `if`, `while`, ternary, or a `&&`/`||`/`!` inside one. */
function isFoldableCondition(node: Node): boolean {
  let child: Node = node;
  let current: Node | undefined = node.getParent();
  while (current !== undefined) {
    if (Node.isIfStatement(current) || Node.isWhileStatement(current)) {
      return current.getExpression() === child;
    }
    if (Node.isConditionalExpression(current)) return current.getCondition() === child;
    if (
      Node.isBinaryExpression(current) ||
      Node.isPrefixUnaryExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isTypeOfExpression(current)
    ) {
      child = current;
      current = current.getParent();
      continue;
    }
    return false;
  }
  return false;
}

export function findBuildDefineViolations(
  file: string,
  source: string,
): readonly BuildDefineViolation[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(file, source);
  const violations: BuildDefineViolation[] = [];

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = identifier.getText();
    if (!DEFINES.has(name)) continue;
    const parent = identifier.getParent();
    // The `declare const` that gives the define a type is not a read.
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier) continue;
    if (isFoldableCondition(identifier)) continue;
    violations.push({
      file,
      line: identifier.getStartLineNumber(),
      message: `${file}:${String(identifier.getStartLineNumber())} reads ${name} outside a branch condition; esbuild cannot fold it and the guarded code ships`,
    });
  }
  return violations;
}
