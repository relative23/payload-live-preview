/**
 * A barrel only re-exports. Coverage leaves every `index.ts` under `src/` out
 * (`vitest.config.ts`), and the mutation scope is read from the files coverage
 * measures, so logic in a barrel is logic no gate looks at. This rule keeps
 * the exclusion honest: every top-level statement of such a file is an
 * `export … from`, and anything else belongs in a module beside it.
 */

import { createSourceFile, isExportDeclaration, ScriptTarget, SyntaxKind } from 'typescript';
import type { ArchitectureViolation } from './architecture-rules';

const BARREL = /^src\/(?:.+\/)?index\.ts$/u;

export function isBarrel(path: string): boolean {
  return BARREL.test(path);
}

/** One violation per barrel: how many statements are not re-exports, and where the first one is. */
export function findBarrelViolations(
  paths: readonly string[],
  sourceOf: (path: string) => string,
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const path of paths) {
    if (!isBarrel(path)) continue;
    const source = createSourceFile(path, sourceOf(path), ScriptTarget.Latest, true);
    const offending = source.statements.filter(
      (statement) => !isExportDeclaration(statement) || statement.moduleSpecifier === undefined,
    );
    const first = offending[0];
    if (first === undefined) continue;
    const line = source.getLineAndCharacterOfPosition(first.getStart(source)).line + 1;
    violations.push({
      kind: 'barrel-logic',
      module: path,
      message:
        `${path} holds ${String(offending.length)} statement(s) that are not re-exports, the first ` +
        `(${SyntaxKind[first.kind]}) at line ${String(line)}; a barrel only re-exports, move them to a module beside it`,
    });
  }
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}
