/**
 * Ledger entry 9: `fetchPreviewDocument()`/`fetchPreviewGlobal()` on the root
 * entry → `definePreview({ serverURL, depth }).fetchDocument()`/`.fetchGlobal()`
 * on `payload-live-preview/server`.
 */
import {
  PACKAGE_NAME,
  declaresName,
  loadTsMorph,
  packageBindings,
  propertyKey,
  referencesTo,
  type PackageBinding,
} from '../ast';
import type { CodemodImplementation, CodemodConflict, CodemodPlan, TextEdit } from '../types';
import type {
  CallExpression,
  ImportDeclaration,
  ObjectLiteralExpression,
  SourceFile,
} from 'ts-morph';

const ID = 'move-fetch-preview-helpers';
const SERVER_SPECIFIER = `${PACKAGE_NAME}/server`;
const METHOD: Readonly<Record<string, string>> = {
  fetchPreviewDocument: 'fetchDocument',
  fetchPreviewGlobal: 'fetchGlobal',
};
const SERVER_OPTIONS = new Set(['serverURL', 'apiRoute', 'depth']);
const DROPPED_OPTIONS = new Set(['draft', 'fetchFn']);
const DEPTH_TODO =
  'depth: 1 /* TODO(pll migrate): the 1.x default; match the runtime mergeDepth */';
const AUTHORIZATION_TODO =
  'authorization: null /* TODO(pll migrate): pass the verdict from authorizePreviewRequest(); ' +
  'null reads the published document */';

function conflict(line: number, reason: string): CodemodConflict {
  return { codemod: ID, reason, line };
}

interface RewrittenCall {
  readonly edit: TextEdit;
  readonly note: CodemodConflict;
}

function rewriteCall(
  call: CallExpression,
  options: ObjectLiteralExpression,
  imported: string,
): RewrittenCall {
  const server: string[] = [];
  const read: string[] = [];
  const dropped: string[] = [];
  const keys = new Set<string>();
  for (const property of options.getProperties()) {
    const key = propertyKey(property);
    if (key !== undefined) keys.add(key);
    if (key !== undefined && SERVER_OPTIONS.has(key)) server.push(property.getText());
    else if (key !== undefined && DROPPED_OPTIONS.has(key)) dropped.push(key);
    else read.push(property.getText());
  }
  if (!keys.has('depth')) server.push(DEPTH_TODO);
  if (!keys.has('authorization')) read.push(AUTHORIZATION_TODO);
  const typeArguments = call.getTypeArguments().map((argument) => argument.getText());
  const generic = typeArguments.length === 0 ? '' : `<${typeArguments.join(', ')}>`;
  const method = METHOD[imported] ?? imported;
  const text = `definePreview({ ${server.join(', ')} }).${method}${generic}({ ${read.join(', ')} })`;
  const droppedNote = dropped.length === 0 ? '' : `, and ${dropped.join('/')} was dropped`;
  return {
    edit: { start: call.getStart(), end: call.getEnd(), text },
    note: conflict(
      call.getStartLineNumber(),
      `${imported}() was rewritten onto definePreview().${method}(); it now returns a ` +
        `PreviewFetchResult (check ok/data) and needs a real authorization for drafts${droppedNote}`,
    ),
  };
}

function importLine(quote: string, names: readonly string[], specifier: string): string {
  return `import { ${names.join(', ')} } from ${quote}${specifier}${quote};`;
}

/** Drop the moved names from their root imports and make sure `definePreview` is imported from the server entry. */
function rewriteImports(script: SourceFile, bindings: readonly PackageBinding[]): TextEdit[] {
  const { Node } = loadTsMorph();
  const edits: TextEdit[] = [];
  const declarations = new Set<ImportDeclaration>();
  for (const binding of bindings) {
    if (Node.isImportDeclaration(binding.declaration)) declarations.add(binding.declaration);
  }
  const serverImport = script
    .getImportDeclarations()
    .find(
      (declaration) =>
        declaration.getModuleSpecifierValue() === SERVER_SPECIFIER && !declaration.isTypeOnly(),
    );
  const hasDefinePreview =
    serverImport?.getNamedImports().some((spec) => spec.getName() === 'definePreview') === true;
  let serverLine: string | undefined;
  if (serverImport !== undefined && !hasDefinePreview) {
    const quote = serverImport.getModuleSpecifier().getQuoteKind();
    const names = [
      ...serverImport.getNamedImports().map((spec) => spec.getText()),
      'definePreview',
    ];
    const defaultImport = serverImport.getDefaultImport()?.getText();
    const clauses =
      defaultImport === undefined ? names.join(', ') : `${defaultImport}, { ${names.join(', ')} }`;
    const text =
      defaultImport === undefined
        ? importLine(quote, names, SERVER_SPECIFIER)
        : `import ${clauses} from ${quote}${SERVER_SPECIFIER}${quote};`;
    edits.push({ start: serverImport.getStart(), end: serverImport.getEnd(), text });
  }
  for (const declaration of declarations) {
    const quote = declaration.getModuleSpecifier().getQuoteKind();
    const remaining = declaration
      .getNamedImports()
      .filter((spec) => !(spec.getName() in METHOD))
      .map((spec) => spec.getText());
    const defaultImport = declaration.getDefaultImport()?.getText();
    const clauses = [
      defaultImport,
      remaining.length === 0 ? undefined : `{ ${remaining.join(', ')} }`,
    ].filter((clause): clause is string => clause !== undefined);
    const typeOnly = declaration.isTypeOnly() ? 'type ' : '';
    const kept =
      clauses.length === 0
        ? ''
        : `import ${typeOnly}${clauses.join(', ')} from ${quote}${PACKAGE_NAME}${quote};`;
    if (serverImport === undefined && serverLine === undefined) {
      serverLine = importLine(quote, ['definePreview'], SERVER_SPECIFIER);
      edits.push({
        start: declaration.getStart(),
        end: declaration.getEnd(),
        text: kept === '' ? serverLine : `${kept}\n${serverLine}`,
      });
    } else {
      // A removed declaration takes its line break with it.
      const end = declaration.getEnd();
      const trailingNewline = kept === '' && script.getFullText()[end] === '\n' ? 1 : 0;
      edits.push({ start: declaration.getStart(), end: end + trailingNewline, text: kept });
    }
  }
  return edits;
}

function plan(script: SourceFile, bindings: readonly PackageBinding[]): CodemodPlan {
  const { Node } = loadTsMorph();
  const blocking: CodemodConflict[] = [];
  const notes: CodemodConflict[] = [];
  const edits: TextEdit[] = [];
  for (const binding of bindings) {
    if (binding.kind === 'require') {
      blocking.push(
        conflict(
          binding.declaration.getStartLineNumber(),
          `${binding.imported} is bound with require(); rewrite it onto definePreview() from ` +
            `${SERVER_SPECIFIER} by hand`,
        ),
      );
      continue;
    }
    for (const reference of referencesTo(script, binding)) {
      const line = reference.node.getStartLineNumber();
      const call = reference.node.getParent();
      const isCall =
        reference.kind === 'reference' &&
        Node.isCallExpression(call) &&
        call.getExpression() === reference.node;
      if (!isCall) {
        blocking.push(
          conflict(
            line,
            `${binding.local} is used other than as a direct call; rewrite it onto definePreview() by hand`,
          ),
        );
        continue;
      }
      const [options] = call.getArguments();
      if (
        options === undefined ||
        !Node.isObjectLiteralExpression(options) ||
        options.getProperties().some((property) => Node.isSpreadAssignment(property))
      ) {
        blocking.push(
          conflict(
            line,
            `${binding.imported}() options are not a plain object literal, so serverURL/depth ` +
              'cannot be split out; rewrite it onto definePreview() by hand',
          ),
        );
        continue;
      }
      const rewritten = rewriteCall(call, options, binding.imported);
      edits.push(rewritten.edit);
      notes.push(rewritten.note);
    }
  }
  const serverDeclaration = script
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() === SERVER_SPECIFIER);
  const foreign = declaresName(script, 'definePreview', serverDeclaration);
  if (foreign !== undefined) {
    blocking.push(
      conflict(
        foreign.getStartLineNumber(),
        `this module already binds a definePreview that is not ${SERVER_SPECIFIER}'s; rename it, ` +
          'then move the fetch helpers by hand',
      ),
    );
  }
  if (blocking.length > 0) return { edits: [], conflicts: [...blocking, ...notes] };
  edits.push(...rewriteImports(script, bindings));
  return { edits, conflicts: notes };
}

export const moveFetchPreviewHelpers: CodemodImplementation = {
  id: ID,
  summary:
    '`fetchPreviewDocument`/`fetchPreviewGlobal` from the root → `definePreview().fetchDocument`/`.fetchGlobal` (payload-live-preview/server)',
  ledgerEntry: 9,
  apply(script) {
    const bindings = packageBindings(script).filter(
      (binding) => binding.specifier === PACKAGE_NAME && binding.imported in METHOD,
    );
    if (bindings.length === 0) return { edits: [], conflicts: [] };
    return plan(script, bindings);
  },
};
