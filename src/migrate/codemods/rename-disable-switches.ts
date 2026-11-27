/**
 * Ledger entry 38: the three switches that named what they turn off are named by what they turn
 * on, so the value turns round: `disableVisibilityGate: true` → `enableVisibilityGate: false`.
 * Only a literal `true` or `false` is rewritten. Any other value may be `undefined`, which meant
 * the default under the old name and would read as "on" once negated.
 */
import { loadTsMorph, replaceNode } from '../ast';
import { memberNamed, optionLiterals, packageJsxAttributes } from '../option-literals';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';

const ID = 'rename-disable-switches';

/** @internal */
export const TURNED_SWITCHES: Readonly<Record<string, string>> = {
  disableVisibilityGate: 'enableVisibilityGate',
  disableReferrerDetection: 'enableReferrerDetection',
  disableLocalhostMatching: 'enableLocalhostMatching',
};

export const renameDisableSwitches: CodemodImplementation = {
  id: ID,
  summary:
    '`disableVisibilityGate: true` → `enableVisibilityGate: false`, and the two origin switches',
  ledgerEntry: 38,
  apply(script) {
    const { Node, SyntaxKind } = loadTsMorph();
    const edits: TextEdit[] = [];
    const conflicts: CodemodConflict[] = [];
    for (const [oldKey, newKey] of Object.entries(TURNED_SWITCHES)) {
      const byHand = `rename it to ${newKey} by hand, with the value turned round`;
      for (const [literal, uses] of optionLiterals(script)) {
        const property = memberNamed(literal, oldKey);
        if (property === undefined) continue;
        const line = property.getStartLineNumber();
        const both = [literal, ...uses.map((use) => use.outer)].some(
          (candidate) => memberNamed(candidate, newKey) !== undefined,
        );
        if (both) {
          conflicts.push({
            codemod: ID,
            line,
            reason: `both ${oldKey} and ${newKey} are given; 3.0 refuses ${oldKey}, drop it by hand`,
          });
          continue;
        }
        const value = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
        const kind = value?.getKind();
        if (kind !== SyntaxKind.TrueKeyword && kind !== SyntaxKind.FalseKeyword) {
          conflicts.push({
            codemod: ID,
            line,
            reason: `${oldKey} is not a literal true or false; ${byHand}`,
          });
          continue;
        }
        edits.push(replaceNode(property, `${newKey}: ${String(kind === SyntaxKind.FalseKeyword)}`));
      }
      for (const attribute of packageJsxAttributes(script, oldKey)) {
        conflicts.push({
          codemod: ID,
          line: attribute.getStartLineNumber(),
          reason: `a JSX attribute; ${byHand}`,
        });
      }
    }
    return { edits, conflicts };
  },
};
