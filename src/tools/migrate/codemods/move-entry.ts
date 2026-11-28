/**
 * An entry that moved into another one under the same export names: every place
 * a script names it as a module (`import … from`, `export … from`, `import()`,
 * `require()`, an `import('…')` type) names the entry that took its exports.
 * Only the specifier changes, inside the quotes the file uses. Where the taking
 * entry lacks some of the names, a declaration that lists only those goes to
 * the entry that has them, and one that mixes both is reported and left.
 */
import { PACKAGE_NAME, loadTsMorph } from '../ast';
import type { CodemodConflict, CodemodImplementation, TextEdit } from '../types';
import type { SourceFile, StringLiteral } from 'ts-morph';

export interface MovedEntry {
  readonly id: string;
  readonly summary: string;
  readonly ledgerEntry: number;
  /** The entry that left, without the package name: `payload`. */
  readonly from: string;
  /** The entry that exports its names now; `''` for the root. */
  readonly to: string;
  /** The names `to` does not export, and the entry that does. */
  readonly elsewhere?: { readonly names: readonly string[]; readonly to: string };
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

/**
 * The exported names a declaration takes from the module it names. `undefined` where it takes
 * the module whole (`import *`, `export *`, `import()`, `require()`), so no name decides.
 */
function namesTaken(literal: StringLiteral): readonly string[] | undefined {
  const { Node: N } = loadTsMorph();
  const parent = literal.getParent();
  if (N.isImportDeclaration(parent)) {
    if (parent.getNamespaceImport() !== undefined || parent.getDefaultImport() !== undefined) {
      return undefined;
    }
    return parent.getNamedImports().map((specifier) => specifier.getName());
  }
  if (N.isExportDeclaration(parent)) {
    return parent.isNamespaceExport()
      ? undefined
      : parent.getNamedExports().map((specifier) => specifier.getName());
  }
  if (N.isLiteralTypeNode(parent)) {
    const qualifier = parent.getParentIfKind(loadTsMorph().SyntaxKind.ImportType)?.getQualifier();
    // `import('…').Outer.Inner` takes `Outer` from the module.
    return qualifier === undefined ? undefined : [qualifier.getText().split('.')[0] ?? ''];
  }
  return undefined;
}

export function movedEntry(entry: MovedEntry): CodemodImplementation {
  const from = specifierOf(entry.from);
  const to = specifierOf(entry.to);
  const elsewhere = new Set(entry.elsewhere?.names);
  const other = specifierOf(entry.elsewhere?.to ?? entry.to);
  return {
    id: entry.id,
    summary: entry.summary,
    ledgerEntry: entry.ledgerEntry,
    apply: (script: SourceFile) => {
      const { SyntaxKind } = loadTsMorph();
      const edits: TextEdit[] = [];
      const conflicts: CodemodConflict[] = [];
      for (const literal of script.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
        if (literal.getLiteralValue() !== from || !namesModule(literal)) continue;
        const names = namesTaken(literal) ?? [];
        const away = names.filter((name) => elsewhere.has(name));
        if (away.length > 0 && away.length < names.length) {
          const stay = names.filter((name) => !elsewhere.has(name));
          conflicts.push({
            codemod: entry.id,
            reason: `\`${from}\` is gone and its names are in two entries now: take ${stay.join(', ')} from \`${to}\` and ${away.join(', ')} from \`${other}\``,
            line: literal.getStartLineNumber(),
          });
          continue;
        }
        // Between the quotes, so the file keeps the ones it uses.
        edits.push({
          start: literal.getStart() + 1,
          end: literal.getEnd() - 1,
          text: away.length > 0 ? other : to,
        });
      }
      return { edits, conflicts };
    },
  };
}
