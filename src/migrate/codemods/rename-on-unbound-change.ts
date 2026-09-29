/** Ledger entry 19: `onUnboundChange: 'route' | 'ignore'` → `onUnfaithfulPatch: 'escalate' | 'ignore'`. */
import { loadTsMorph, replaceNode } from '../ast';
import { memberNamed, optionLiterals, packageJsxAttributes } from '../option-literals';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';

const ID = 'rename-on-unbound-change';
const OLD_KEY = 'onUnboundChange';
const NEW_KEY = 'onUnfaithfulPatch';
const RENAMED: Readonly<Record<string, string>> = { route: 'escalate', ignore: 'ignore' };

export const renameOnUnboundChange: CodemodImplementation = {
  id: ID,
  summary: "`onUnboundChange: 'route'` → `onUnfaithfulPatch: 'escalate'`",
  ledgerEntry: 19,
  apply(script) {
    const { Node } = loadTsMorph();
    const edits: TextEdit[] = [];
    const conflicts: CodemodConflict[] = [];
    for (const [literal, uses] of optionLiterals(script)) {
      const property = memberNamed(literal, OLD_KEY);
      if (property === undefined) continue;
      const line = property.getStartLineNumber();
      // The package reads the new name first; renamed, the later key would win instead.
      const both = [literal, ...uses.map((use) => use.outer)].some(
        (candidate) => memberNamed(candidate, NEW_KEY) !== undefined,
      );
      if (both) {
        conflicts.push({
          codemod: ID,
          line,
          reason: `both ${OLD_KEY} and ${NEW_KEY} are given; ${NEW_KEY} wins, drop ${OLD_KEY} by hand`,
        });
        continue;
      }
      const value = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      const text = value !== undefined && Node.isStringLiteral(value) ? value.getLiteralText() : '';
      const renamed = RENAMED[text];
      if (value === undefined || renamed === undefined) {
        conflicts.push({
          codemod: ID,
          line,
          reason: `${OLD_KEY} is not a literal 'route' or 'ignore'; rename it to ${NEW_KEY} by hand ('route' is 'escalate')`,
        });
        continue;
      }
      const quote = value.getText().charAt(0);
      edits.push(replaceNode(property, `${NEW_KEY}: ${quote}${renamed}${quote}`));
    }
    for (const attribute of packageJsxAttributes(script, OLD_KEY)) {
      conflicts.push({
        codemod: ID,
        line: attribute.getStartLineNumber(),
        reason: `a JSX attribute; rename ${OLD_KEY} to ${NEW_KEY} by hand ('route' is 'escalate')`,
      });
    }
    return { edits, conflicts };
  },
};
