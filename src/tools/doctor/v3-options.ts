/**
 * What a reader of the source can know about an options argument: the keys it
 * sets, the keys it sets on one side of a condition, and the values that are
 * written out. A spread it cannot follow leaves the literal open, so a missing
 * key is reported as unknown, never as absent.
 */
import type { Node, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { loadTsMorph, propertyKey } from '../migrate/ast';
import { unwrap } from '../migrate/option-literals';

/** `true`, `false` or a string where the source writes one; the facts of a nested literal; `undefined` for anything else. */
export type OptionValue = boolean | string | OptionFacts | undefined;

export interface OptionFacts {
  /** The keys that are set whichever way a condition falls. */
  readonly keys: ReadonlyMap<string, OptionValue>;
  /** Keys only one side of a condition sets, as in `...(admin ? { serverURL } : {})`. */
  readonly maybe: ReadonlySet<string>;
  /** A spread or a computed key the reader could not follow: a key that is not listed may still be set. */
  readonly open: boolean;
}

/** A name the script imports from a relative module, under the name that module exports. */
export interface RelativeImport {
  readonly specifier: string;
  readonly name: string;
}

/** The options another module declares under `name`, already read; `undefined` when they could not be. */
export type SharedOptions = (from: RelativeImport) => OptionFacts | undefined;

/** An argument that is not there sets nothing, and that is known. */
export const NO_OPTIONS: OptionFacts = { keys: new Map(), maybe: new Set(), open: false };

/** Options nest through spreads and consts; a cycle cannot be written, a long chain is not worth following. */
const MAX_DEPTH = 8;

/** The names this script imports from `./` and `../` modules. */
export function relativeImports(script: SourceFile): ReadonlyMap<string, RelativeImport> {
  const found = new Map<string, RelativeImport>();
  for (const declaration of script.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    for (const spec of declaration.getNamedImports()) {
      found.set((spec.getAliasNode() ?? spec.getNameNode()).getText(), {
        specifier,
        name: spec.getName(),
      });
    }
  }
  return found;
}

/** The options a module declares in its top-level `const`s, by the name of the const. */
export function declaredOptions(script: SourceFile): ReadonlyMap<string, OptionFacts> {
  const { VariableDeclarationKind } = loadTsMorph();
  const found = new Map<string, OptionFacts>();
  for (const statement of script.getVariableStatements()) {
    if (statement.getDeclarationKind() !== VariableDeclarationKind.Const) continue;
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      // One hop: what this module imports in turn is not followed.
      const facts =
        initializer === undefined
          ? undefined
          : optionFacts(initializer, new Map(), () => undefined);
      if (facts !== undefined) found.set(declaration.getName(), facts);
    }
  }
  return found;
}

/** What a `const` of this script is initialised with. */
function constInitializer(name: Node): Node | undefined {
  const { Node, VariableDeclarationKind } = loadTsMorph();
  for (const declaration of name.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const kind = declaration.getVariableStatement()?.getDeclarationKind();
    if (kind === VariableDeclarationKind.Const) return declaration.getInitializer();
  }
  return undefined;
}

/** Both sides of a condition: what both set is set, what one sets may be. */
function either(a: OptionFacts | undefined, b: OptionFacts | undefined): OptionFacts | undefined {
  if (a === undefined || b === undefined) return undefined;
  const keys = new Map<string, OptionValue>();
  const maybe = new Set([...a.maybe, ...b.maybe]);
  for (const [key, value] of a.keys) {
    if (b.keys.has(key)) keys.set(key, b.keys.get(key) === value ? value : undefined);
    else maybe.add(key);
  }
  for (const key of b.keys.keys()) if (!a.keys.has(key)) maybe.add(key);
  return { keys, maybe, open: a.open || b.open };
}

/**
 * The facts of one argument: a literal, a `const` that leads to one, a name a
 * relative import brings, or a condition between two of those. `undefined`
 * for anything else.
 */
export function optionFacts(
  argument: Node,
  imports: ReadonlyMap<string, RelativeImport>,
  shared: SharedOptions,
  depth = 0,
): OptionFacts | undefined {
  const { Node, SyntaxKind } = loadTsMorph();
  const inner = unwrap(argument);
  if (depth > MAX_DEPTH) return undefined;
  const read = (node: Node): OptionFacts | undefined =>
    optionFacts(node, imports, shared, depth + 1);
  if (Node.isObjectLiteralExpression(inner)) return literalFacts(inner, read);
  if (Node.isConditionalExpression(inner)) {
    return either(read(inner.getWhenTrue()), read(inner.getWhenFalse()));
  }
  // `...(admin && { serverURL })` spreads the literal or nothing.
  const guarded =
    Node.isBinaryExpression(inner) &&
    inner.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken;
  if (guarded) return either(NO_OPTIONS, read(inner.getRight()));
  if (!Node.isIdentifier(inner)) return undefined;
  const initializer = constInitializer(inner);
  if (initializer !== undefined) return read(initializer);
  const imported = imports.get(inner.getText());
  return imported === undefined ? undefined : shared(imported);
}

function literalFacts(
  literal: ObjectLiteralExpression,
  read: (node: Node) => OptionFacts | undefined,
): OptionFacts {
  const { Node, SyntaxKind } = loadTsMorph();
  const keys = new Map<string, OptionValue>();
  const maybe = new Set<string>();
  let open = false;
  const set = (key: string, value: OptionValue): void => {
    keys.set(key, value);
    maybe.delete(key);
  };
  for (const property of literal.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = read(property.getExpression());
      if (spread === undefined) {
        open = true;
        continue;
      }
      for (const [key, value] of spread.keys) set(key, value);
      for (const key of spread.maybe) {
        // Set before and perhaps set again: the key is there, its value is not known.
        if (keys.has(key)) keys.set(key, undefined);
        else maybe.add(key);
      }
      open ||= spread.open;
      continue;
    }
    const key = propertyKey(property);
    if (key === undefined) {
      open = true;
      continue;
    }
    // `{ document }` and a method set the key; only an assignment writes a value out.
    const written = Node.isPropertyAssignment(property)
      ? unwrap(property.getInitializerOrThrow())
      : undefined;
    if (written === undefined) set(key, undefined);
    else if (written.getKind() === SyntaxKind.TrueKeyword) set(key, true);
    else if (written.getKind() === SyntaxKind.FalseKeyword) set(key, false);
    else if (Node.isStringLiteral(written) || Node.isNoSubstitutionTemplateLiteral(written)) {
      set(key, written.getLiteralText());
    } else set(key, read(written));
  }
  return { keys, maybe, open };
}
