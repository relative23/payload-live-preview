/** Ledger entry 7: `createPreviewBindings({ authorized })` → `{ authorization }`. */
import { loadTsMorph, packageBindings, propertyKey, referencesTo, replaceNode } from '../ast';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';

const ID = 'rename-bindings-authorized-option';
const OLD_KEY = 'authorized';
const NEW_KEY = 'authorization';
const BY_HAND =
  `if they carry \`${OLD_KEY}\`, rename it to \`${NEW_KEY}\` and pass the verdict from ` +
  'authorizePreviewRequest()';
/**
 * `false` has an exact equivalent — an unauthorized response suppresses every
 * binding, which is what `null` means — so it is rewritten. Nothing else does:
 * only a real context from `authorizePreviewRequest()` authorizes emission, and
 * a boolean left under the new name does not compile (TS2322).
 */
const BOOLEAN_REFUSED =
  `\`${NEW_KEY}\` takes the context from authorizePreviewRequest(); the boolean 1.x ` +
  'accepted is not. The key was renamed and its value left as it stands — pass the ' +
  'verdict, or `null` for a public response';

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
            conflicts.push({
              codemod: ID,
              line: property.getStartLineNumber(),
              reason: BOOLEAN_REFUSED,
            });
          } else if (Node.isPropertyAssignment(property)) {
            const value = property.getInitializer();
            if (value !== undefined && Node.isFalseLiteral(value)) {
              edits.push(replaceNode(property, `${NEW_KEY}: null`));
              continue;
            }
            edits.push(replaceNode(property.getNameNode(), NEW_KEY));
            conflicts.push({
              codemod: ID,
              line: property.getStartLineNumber(),
              reason: BOOLEAN_REFUSED,
            });
          }
        }
      }
    }
    return { edits, conflicts };
  },
};
