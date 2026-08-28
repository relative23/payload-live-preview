/**
 * ts-morph access for the codemods: parsing, the package's bindings in a
 * script and the references those bindings have. ts-morph is loaded on first
 * use so the entry stays importable without the optional peer.
 */
import { createRequire } from 'node:module';
import type * as TsMorphModule from 'ts-morph';
import type {
  Identifier,
  Node,
  ObjectLiteralElementLike,
  Project,
  SourceFile,
  Symbol as TsSymbol,
} from 'ts-morph';
import type { TextEdit } from './types';

type TsMorph = typeof TsMorphModule;

export type ScriptKind = 'ts' | 'tsx' | 'js' | 'jsx';

export const PACKAGE_NAME = 'payload-live-preview';

let tsMorph: TsMorph | undefined;
let project: Project | undefined;

export function loadTsMorph(): TsMorph {
  if (tsMorph === undefined) {
    try {
      tsMorph = createRequire(import.meta.url)('ts-morph') as TsMorph;
    } catch (error) {
      throw new Error('pll migrate needs ts-morph: npm install --save-dev ts-morph', {
        cause: error,
      });
    }
  }
  return tsMorph;
}

/** Parse one script into a throwaway in-memory project; the previous script is discarded. */
export function parseScript(text: string, kind: ScriptKind): SourceFile {
  const morph = loadTsMorph();
  project ??= new morph.Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noLib: true },
  });
  return project.createSourceFile(`/script.${kind}`, text, { overwrite: true });
}

export function isPackageSpecifier(specifier: string): boolean {
  return specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`);
}

/** A name the script binds from the package, by `import` or by destructuring `require()`/`import()`. */
export interface PackageBinding {
  /** The exported name, as the package spells it. */
  readonly imported: string;
  /** The name the script uses; equals `imported` unless aliased. */
  readonly local: string;
  readonly specifier: string;
  readonly kind: 'import' | 'require';
  /** The node spelling the exported name; rewritten when the export is renamed. */
  readonly importedNode: Node;
  readonly aliased: boolean;
  readonly symbol: TsSymbol | undefined;
  /** The import declaration or variable declaration that binds it. */
  readonly declaration: Node;
}

export function packageBindings(script: SourceFile): readonly PackageBinding[] {
  const { Node, SyntaxKind } = loadTsMorph();
  const out: PackageBinding[] = [];
  for (const declaration of script.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!isPackageSpecifier(specifier)) continue;
    for (const spec of declaration.getNamedImports()) {
      const alias = spec.getAliasNode();
      const localNode = alias ?? spec.getNameNode();
      out.push({
        imported: spec.getName(),
        local: localNode.getText(),
        specifier,
        kind: 'import',
        importedNode: spec.getNameNode(),
        aliased: alias !== undefined,
        symbol: localNode.getSymbol(),
        declaration,
      });
    }
  }
  for (const declaration of script.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const specifier = requiredSpecifier(declaration.getInitializer());
    const pattern = declaration.getNameNode();
    if (specifier === undefined || !isPackageSpecifier(specifier)) continue;
    if (!Node.isObjectBindingPattern(pattern)) continue;
    for (const element of pattern.getElements()) {
      const nameNode = element.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;
      const propertyName = element.getPropertyNameNode();
      out.push({
        imported: propertyName === undefined ? nameNode.getText() : literalName(propertyName),
        local: nameNode.getText(),
        specifier,
        kind: 'require',
        importedNode: propertyName ?? nameNode,
        aliased: propertyName !== undefined,
        symbol: nameNode.getSymbol(),
        declaration,
      });
    }
  }
  return out;
}

function requiredSpecifier(initializer: Node | undefined): string | undefined {
  const { Node, SyntaxKind } = loadTsMorph();
  const call =
    initializer !== undefined && Node.isAwaitExpression(initializer)
      ? initializer.getExpression()
      : initializer;
  if (call === undefined || !Node.isCallExpression(call)) return undefined;
  const callee = call.getExpression();
  const isRequire = Node.isIdentifier(callee) && callee.getText() === 'require';
  if (!isRequire && callee.getKind() !== SyntaxKind.ImportKeyword) return undefined;
  const [argument] = call.getArguments();
  return argument !== undefined && Node.isStringLiteral(argument)
    ? argument.getLiteralText()
    : undefined;
}

function literalName(node: Node): string {
  const { Node } = loadTsMorph();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return node.getText();
}

/** The key of an object-literal member, or `undefined` when it is computed. */
export function propertyKey(property: ObjectLiteralElementLike): string | undefined {
  const { Node } = loadTsMorph();
  if (Node.isSpreadAssignment(property)) return undefined;
  const nameNode = property.getNameNode();
  if (Node.isComputedPropertyName(nameNode)) return undefined;
  return literalName(nameNode);
}

export type ReferenceKind = 'reference' | 'shorthand' | 'export';

export interface BindingReference {
  readonly node: Identifier;
  /** `shorthand` is `{ name }`, `export` is `export { name }`; both keep the old key visible. */
  readonly kind: ReferenceKind;
}

/** Every use of the binding outside its own declaration, resolved by symbol so shadowing is respected. */
export function referencesTo(
  script: SourceFile,
  binding: PackageBinding,
): readonly BindingReference[] {
  const { Node, SyntaxKind } = loadTsMorph();
  const target = binding.symbol?.compilerSymbol;
  if (target === undefined) return [];
  const checker = script.getProject().getTypeChecker();
  const out: BindingReference[] = [];
  for (const node of script.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (node.getText() !== binding.local || isInside(node, binding.declaration)) continue;
    const parent = node.getParent();
    if (Node.isShorthandPropertyAssignment(parent)) {
      if (checker.getShorthandAssignmentValueSymbol(parent)?.compilerSymbol === target) {
        out.push({ node, kind: 'shorthand' });
      }
      continue;
    }
    if (Node.isExportSpecifier(parent)) {
      if (
        parent.getNameNode() === node &&
        parent.getLocalTargetSymbol()?.compilerSymbol === target
      ) {
        out.push({ node, kind: 'export' });
      }
      continue;
    }
    if (node.getSymbol()?.compilerSymbol === target) out.push({ node, kind: 'reference' });
  }
  return out;
}

function isInside(node: Node, ancestor: Node): boolean {
  return node.getFirstAncestor((candidate) => candidate === ancestor) !== undefined;
}

/** The declaration that binds `name` anywhere in the script, ignoring those in `except`. */
export function declaresName(
  script: SourceFile,
  name: string,
  except: readonly Node[] = [],
): Node | undefined {
  const { SyntaxKind } = loadTsMorph();
  for (const node of script.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (node.getText() !== name) continue;
    const parent = node.getParent();
    if (!bindsIdentifier(parent, node)) continue;
    if (except.some((skip) => skip === parent || isInside(parent, skip))) continue;
    return parent;
  }
  return undefined;
}

function bindsIdentifier(parent: Node, node: Identifier): boolean {
  const { Node } = loadTsMorph();
  if (
    Node.isVariableDeclaration(parent) ||
    Node.isBindingElement(parent) ||
    Node.isFunctionDeclaration(parent) ||
    Node.isClassDeclaration(parent) ||
    Node.isParameterDeclaration(parent) ||
    Node.isEnumDeclaration(parent)
  ) {
    return parent.getNameNode() === node;
  }
  if (Node.isImportSpecifier(parent)) {
    return (parent.getAliasNode() ?? parent.getNameNode()) === node;
  }
  if (Node.isImportClause(parent)) return parent.getDefaultImport() === node;
  if (Node.isNamespaceImport(parent)) return parent.getNameNode() === node;
  return false;
}

/** Identifiers spelled `name` that are member names (`x.name`), never the package's binding. */
export function memberAccesses(script: SourceFile, name: string): readonly Identifier[] {
  const { Node, SyntaxKind } = loadTsMorph();
  return script.getDescendantsOfKind(SyntaxKind.Identifier).filter((node) => {
    const parent = node.getParent();
    return (
      node.getText() === name &&
      Node.isPropertyAccessExpression(parent) &&
      parent.getNameNode() === node
    );
  });
}

export function replaceNode(node: Node, text: string): TextEdit {
  return { start: node.getStart(), end: node.getEnd(), text };
}

/** Splice non-overlapping edits into `text`. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let output = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (edit.end > floor) throw new Error('overlapping codemod edits');
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
    floor = edit.start;
  }
  return output;
}
