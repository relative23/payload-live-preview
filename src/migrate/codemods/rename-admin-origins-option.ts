/** Ledger entry 13: `hasPreviewIntent(request, { adminOrigins })` → `{ allowedOrigins }`. */
import { loadTsMorph, packageBindings, propertyKey, referencesTo, replaceNode } from '../ast';
import type { CodemodImplementation, CodemodConflict, TextEdit } from '../types';

const ID = 'rename-admin-origins-option';
const CALLEE = 'hasPreviewIntent';
const OLD_KEY = 'adminOrigins';
const NEW_KEY = 'allowedOrigins';
const BY_HAND = `if they carry \`${OLD_KEY}\`, rename it to \`${NEW_KEY}\``;

export const renameAdminOriginsOption: CodemodImplementation = {
  id: ID,
  summary: '`hasPreviewIntent(request, { adminOrigins })` → `{ allowedOrigins }`',
  ledgerEntry: 13,
  apply(script) {
    const { Node } = loadTsMorph();
    const edits: TextEdit[] = [];
    const conflicts: CodemodConflict[] = [];
    const bindings = packageBindings(script).filter((binding) => binding.imported === CALLEE);
    for (const binding of bindings) {
      for (const reference of referencesTo(script, binding)) {
        const call = reference.node.getParent();
        if (reference.kind !== 'reference' || !Node.isCallExpression(call)) continue;
        if (call.getExpression() !== reference.node) continue;
        const options = call.getArguments()[1];
        if (options === undefined) continue;
        const line = options.getStartLineNumber();
        if (!Node.isObjectLiteralExpression(options)) {
          conflicts.push({
            codemod: ID,
            line,
            reason: `${CALLEE}() options are not a literal; ${BY_HAND}`,
          });
          continue;
        }
        const properties = options.getProperties();
        const keys = properties.map((property) => propertyKey(property));
        // With both names the package reads `allowedOrigins` and ignores the
        // alias; renamed, the later key would win instead.
        if (keys.includes(OLD_KEY) && keys.includes(NEW_KEY)) {
          conflicts.push({
            codemod: ID,
            line,
            reason: `${CALLEE}() is given both ${OLD_KEY} and ${NEW_KEY}; ${NEW_KEY} wins, drop ${OLD_KEY} by hand`,
          });
          continue;
        }
        for (const property of properties) {
          if (Node.isSpreadAssignment(property)) {
            conflicts.push({
              codemod: ID,
              line: property.getStartLineNumber(),
              reason: `${CALLEE}() spreads its options; ${BY_HAND}`,
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
