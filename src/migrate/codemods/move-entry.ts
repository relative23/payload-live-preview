/**
 * An entry that moved into another one under the same export names: every place
 * a script names it as a module (`import … from`, `export … from`, `import()`,
 * `require()`, an `import('…')` type) names the entry that took its exports.
 * Only the specifier changes, inside the quotes the file uses.
 */
import { PACKAGE_NAME, loadTsMorph } from '../ast';
import type { CodemodImplementation, TextEdit } from '../types';
import type { SourceFile, StringLiteral } from 'ts-morph';

export interface MovedEntry {
  readonly id: string;
  readonly summary: string;
  readonly ledgerEntry: number;
  /** The entry that left, without the package name: `payload`. */
  readonly from: string;
  /** The entry that exports its names now; `''` for the root. */
  readonly to: string;
}

const specifierOf = (entry: string): string =>
  entry === '' ? PACKAGE_NAME : `${PACKAGE_NAME}/${entry}`;

/** Whether the literal is where a module is named, and not a string that happens to read the same. */
function namesModule(literal: StringLiteral): boolean {
  const { Node: N } = loadTsMorph();
  const parent = literal.getParent();
  if (
    N.isImportDeclaration(parent) ||
    N.isExportDeclaration(parent) ||
    N.isExternalModuleReference(parent)
  ) {
    return true;
  }
  // `import('…').Name` in a type position.
  if (N.isLiteralTypeNode(parent)) return N.isImportTypeNode(parent.getParent());
  if (!N.isCallExpression(parent) || parent.getArguments()[0] !== literal) return false;
  const callee = parent.getExpression();
  return N.isImportExpression(callee) || (N.isIdentifier(callee) && callee.getText() === 'require');
}

export function movedEntry(entry: MovedEntry): CodemodImplementation {
  const from = specifierOf(entry.from);
  const to = specifierOf(entry.to);
  return {
    id: entry.id,
    summary: entry.summary,
    ledgerEntry: entry.ledgerEntry,
    apply: (script: SourceFile) => {
      const { SyntaxKind } = loadTsMorph();
      const edits: TextEdit[] = [];
      for (const literal of script.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
        if (literal.getLiteralValue() !== from || !namesModule(literal)) continue;
        // Between the quotes, so the file keeps the ones it uses.
        edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: to });
      }
      return { edits, conflicts: [] };
    },
  };
}
