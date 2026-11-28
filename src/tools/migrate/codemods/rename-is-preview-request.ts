/** Ledger entry 1: `isPreviewRequest()` → `hasPreviewIntent()`, same signature. */
import {
  declaresName,
  memberAccesses,
  packageBindings,
  packageReexports,
  referencesTo,
  replaceNode,
  type PackageBinding,
  type PackageReexport,
} from '../ast';
import type { CodemodImplementation, CodemodConflict, CodemodPlan, TextEdit } from '../types';

const ID = 'rename-is-preview-request';
const OLD_NAME = 'isPreviewRequest';
const NEW_NAME = 'hasPreviewIntent';

function conflict(line: number, reason: string): CodemodConflict {
  return { codemod: ID, reason, line };
}

function renameBinding(binding: PackageBinding): TextEdit {
  // `import { isPreviewRequest as hasPreviewIntent }` collapses to the bare name.
  if (binding.aliased && binding.local === NEW_NAME) {
    return replaceNode(binding.importedNode.getParentOrThrow(), NEW_NAME);
  }
  return replaceNode(binding.importedNode, NEW_NAME);
}

function plan(
  bindings: readonly PackageBinding[],
  reexports: readonly PackageReexport[],
  script: Parameters<CodemodImplementation['apply']>[0],
): CodemodPlan {
  const blocking: CodemodConflict[] = [];
  const edits: TextEdit[] = [];
  for (const reexport of reexports) {
    if (reexport.alias === undefined) {
      // Renaming it would rename this module's export too; its importers decide.
      blocking.push(
        conflict(
          reexport.line,
          `${OLD_NAME} is re-exported straight from the package under its old name; write ` +
            `export { ${NEW_NAME} as ${OLD_NAME} } from '${reexport.specifier}', or rename it and its importers by hand`,
        ),
      );
    } else if (reexport.alias === NEW_NAME) {
      edits.push(replaceNode(reexport.importedNode.getParentOrThrow(), NEW_NAME));
    } else {
      edits.push(replaceNode(reexport.importedNode, NEW_NAME));
    }
  }
  const existing = declaresName(
    script,
    NEW_NAME,
    bindings.map((binding) => binding.declaration),
  );
  if (existing !== undefined) {
    blocking.push(
      conflict(
        existing.getStartLineNumber(),
        `this module already binds ${NEW_NAME}; rename it (or drop the wrapper and import the ` +
          `package's ${NEW_NAME} directly), then rename ${OLD_NAME} by hand`,
      ),
    );
  }
  for (const binding of bindings) {
    edits.push(renameBinding(binding));
    if (binding.aliased) continue;
    for (const reference of referencesTo(script, binding)) {
      if (reference.kind === 'reference') {
        edits.push(replaceNode(reference.node, NEW_NAME));
      } else if (reference.kind === 'shorthand') {
        blocking.push(
          conflict(
            reference.node.getStartLineNumber(),
            `{ ${OLD_NAME} } keeps the old key for whoever reads it; write ` +
              `{ ${OLD_NAME}: ${NEW_NAME} } or rename the key and its readers by hand`,
          ),
        );
      } else {
        blocking.push(
          conflict(
            reference.node.getStartLineNumber(),
            `${OLD_NAME} is re-exported under its old name; rename the export and its ` +
              `importers, or write export { ${NEW_NAME} as ${OLD_NAME} }`,
          ),
        );
      }
    }
  }
  const notes = memberAccesses(script, OLD_NAME).map((node) =>
    conflict(
      node.getStartLineNumber(),
      `.${OLD_NAME} is a member of this module's own object, not the package import, and was ` +
        'left alone; check that it does not wrap the removed API',
    ),
  );
  if (blocking.length > 0) return { edits: [], conflicts: [...blocking, ...notes] };
  return { edits, conflicts: notes };
}

export const renameIsPreviewRequest: CodemodImplementation = {
  id: ID,
  summary: '`isPreviewRequest()` → `hasPreviewIntent()` (same signature)',
  ledgerEntry: 1,
  // The rename keeps behaviour, and that is the part worth saying: the 2.0
  // adapters count only the query, and a renamed call silently does not.
  notice:
    'hasPreviewIntent() takes the options isPreviewRequest() took and, without `signals`, counts ' +
    'the same three: a preview query parameter, Sec-Fetch-Dest: iframe and an admin Referer. The ' +
    "2.0 adapters count only the query; where a call should agree with them, pass { signals: ['query'] } " +
    '(docs/migration.md).',
  apply(script) {
    const bindings = packageBindings(script).filter((binding) => binding.imported === OLD_NAME);
    const reexports = packageReexports(script).filter((reexport) => reexport.imported === OLD_NAME);
    if (bindings.length === 0 && reexports.length === 0) return { edits: [], conflicts: [] };
    return plan(bindings, reexports, script);
  },
};
