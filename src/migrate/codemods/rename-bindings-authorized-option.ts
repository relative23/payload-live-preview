/** Ledger entry 7: `createPreviewBindings({ authorized })` → `{ authorization }`. */
import { loadTsMorph, packageBindings, propertyKey, referencesTo, replaceNode } from '../ast';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';

const ID = 'rename-bindings-authorized-option';
const OLD_KEY = 'authorized';
const NEW_KEY = 'authorization';
const BY_HAND =
  `if they carry \`${OLD_KEY}\`, rename it to \`${NEW_KEY}\` and pass the verdict from ` +
  'authorizePreviewRequest()';

export const renameBindingsAuthorizedOption: CodemodImplementation = {
  id: ID,
  summary: '`createPreviewBindings({ authorized })` → `{ authorization }`',
  ledgerEntry: 7,
  apply(script) {
    const { Node } = loadTsMorph();
    const edits: TextEdit[] = [];
    const conflicts: CodemodConflict[] = [];
    const bindings = packageBindings(script).filter(
      (binding) => binding.imported === 'createPreviewBindings',
    );
    for (const binding of bindings) {
      for (const reference of referencesTo(script, binding)) {
        const call = reference.node.getParent();
        if (reference.kind !== 'reference' || !Node.isCallExpression(call)) continue;
        if (call.getExpression() !== reference.node) continue;
        const [options] = call.getArguments();
        if (options === undefined) continue;
        const line = options.getStartLineNumber();
        if (!Node.isObjectLiteralExpression(options)) {
          conflicts.push({
            codemod: ID,
            line,
            reason: `createPreviewBindings() options are not a literal; ${BY_HAND}`,
          });
          continue;
        }
        for (const property of options.getProperties()) {
          if (Node.isSpreadAssignment(property)) {
            conflicts.push({
              codemod: ID,
              line: property.getStartLineNumber(),
              reason: `createPreviewBindings() spreads its options; ${BY_HAND}`,
            });
          } else if (propertyKey(property) !== OLD_KEY) {
            continue;
          } else if (Node.isShorthandPropertyAssignment(property)) {
            edits.push(replaceNode(property, `${NEW_KEY}: ${OLD_KEY}`));
          } else if (Node.isPropertyAssignment(property)) {
            edits.push(replaceNode(property.getNameNode(), NEW_KEY));
          }
        }
      }
    }
    return { edits, conflicts };
  },
};
