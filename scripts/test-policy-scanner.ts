/**
 * The static half of the test policy: one file's source in, its declarations
 * and violations out. Runner flags catch focused tests at execution time; this
 * scanner makes skips, todos, expected failures and focused or conditionally
 * registered declarations a zero-budget contract across every suite, selected
 * by a given run or not.
 */

import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclarationKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';

export const TEST_FILE_PATTERN = /\.(?:test|spec|bench)\.[cm]?[jt]sx?$/u;
export const RUNNER_CONFIGS = [
  'playwright.bench.config.ts',
  'playwright.config.ts',
  'playwright.real-payload.config.ts',
  'playwright.soak.config.ts',
  'stryker.config.js',
  'vitest.bench.config.ts',
  'vitest.config.ts',
  'vitest.stryker.config.ts',
] as const;
const TEST_MODULES = new Set(['vitest', '@playwright/test', '@fast-check/vitest']);
const ROOT_IDENTIFIERS = new Set(['bench', 'describe', 'it', 'suite', 'test']);
const FORBIDDEN_MODIFIERS = new Set([
  'fail',
  'fails',
  'failsIf',
  'fixme',
  'only',
  'runIf',
  'skip',
  'skipIf',
  'todo',
]);
const RUNTIME_ANNOTATIONS = new Set(['fail', 'fixme', 'skip']);
const NON_DECLARATION_METHODS = new Set([
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
  'configure',
  'extend',
  'info',
  'setTimeout',
  'slow',
  'step',
  'use',
]);

export type TestKind = 'benchmark' | 'suite' | 'test';
export type TestGroup =
  'benchmarks' | 'browser-bench' | 'e2e' | 'integration' | 'real-payload' | 'soak' | 'unit';

export interface TestPolicyViolation {
  readonly file: string;
  readonly line: number;
  readonly modifier: string;
  readonly message: string;
}

export interface TestDeclaration {
  readonly kind: TestKind;
  readonly line: number;
  readonly title: string;
}

export interface TestFileAnalysis {
  readonly declarations: readonly TestDeclaration[];
  readonly violations: readonly TestPolicyViolation[];
}

interface InvocationChain {
  readonly root: string;
  readonly modifiers: readonly string[];
}

function invocationChain(node: Node): InvocationChain | undefined {
  if (Node.isIdentifier(node)) return { root: node.getText(), modifiers: [] };

  if (Node.isPropertyAccessExpression(node)) {
    const parent = invocationChain(node.getExpression());
    if (parent === undefined) return undefined;
    return { root: parent.root, modifiers: [...parent.modifiers, node.getName()] };
  }

  if (Node.isElementAccessExpression(node)) {
    const parent = invocationChain(node.getExpression());
    const argument = node.getArgumentExpression();
    if (parent === undefined || argument === undefined || !Node.isStringLiteral(argument)) {
      return undefined;
    }
    return { root: parent.root, modifiers: [...parent.modifiers, argument.getLiteralText()] };
  }

  if (Node.isCallExpression(node) || Node.isParenthesizedExpression(node)) {
    return invocationChain(node.getExpression());
  }

  return undefined;
}

interface ImportedTestAliases {
  readonly roots: ReadonlyMap<string, string>;
  readonly namespaces: ReadonlySet<string>;
}

/**
 * Track syntax-level import aliases and namespaces, not arbitrary assignments of
 * runner functions. The full unfiltered run's ZeroSkipReporter complements this
 * scanner by rejecting the resolved mode/result of declarations created through
 * runtime aliases.
 */
function importedTestAliases(sourceFile: SourceFile): ImportedTestAliases {
  const aliases = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const identifier of ROOT_IDENTIFIERS) aliases.set(identifier, identifier);

  for (const declaration of sourceFile.getImportDeclarations()) {
    if (!TEST_MODULES.has(declaration.getModuleSpecifierValue())) continue;
    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport !== undefined) namespaces.add(namespaceImport.getText());
    for (const namedImport of declaration.getNamedImports()) {
      const importedName = namedImport.getName();
      if (!ROOT_IDENTIFIERS.has(importedName)) continue;
      aliases.set(namedImport.getAliasNode()?.getText() ?? importedName, importedName);
    }
  }
  return { roots: aliases, namespaces };
}

function staticTitle(node: Node | undefined): string {
  if (node !== undefined && Node.isStringLiteral(node)) return node.getLiteralText();
  if (node !== undefined && Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return '<dynamic>';
}

function declarationKind(root: string, modifiers: readonly string[]): TestKind | undefined {
  const lastModifier = modifiers.at(-1);
  if (lastModifier !== undefined && NON_DECLARATION_METHODS.has(lastModifier)) return undefined;
  if (root === 'bench') return 'benchmark';
  if (root === 'describe' || root === 'suite' || modifiers.includes('describe')) return 'suite';
  if (root === 'it' || root === 'test') return 'test';
  return undefined;
}

function addViolation(
  violations: TestPolicyViolation[],
  file: string,
  node: Node,
  modifier: string,
  display = modifier,
): void {
  violations.push({
    file,
    line: node.getStartLineNumber(),
    modifier,
    message: `${file}:${String(node.getStartLineNumber())} uses forbidden ${display}`,
  });
}

function propertyName(node: Node): string | undefined {
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    return node.getName();
  }
  return undefined;
}

const ITERATION_METHODS = new Set(['flatMap', 'forEach', 'map']);

/**
 * A registration inside a `forEach`/`map`/`flatMap` callback runs as often as
 * the receiver has elements — zero included — unless that receiver is provably
 * a local array literal. `cases.filter(...).forEach(c => it(...))` therefore
 * registers an unknown number of tests and is treated as conditional.
 */
function isDynamicIterationCallback(node: Node): boolean {
  if (!Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) return false;
  const call = node.getParent();
  if (!Node.isCallExpression(call) || !call.getArguments().includes(node)) return false;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || !ITERATION_METHODS.has(callee.getName())) {
    return false;
  }
  return staticParameterTableState(callee.getExpression()) !== 'non-empty';
}

function hasConditionalRegistration(call: CallExpression): boolean {
  return call
    .getAncestors()
    .some(
      (ancestor) =>
        isDynamicIterationCallback(ancestor) ||
        Node.isIfStatement(ancestor) ||
        Node.isConditionalExpression(ancestor) ||
        Node.isForStatement(ancestor) ||
        Node.isForInStatement(ancestor) ||
        Node.isForOfStatement(ancestor) ||
        Node.isWhileStatement(ancestor) ||
        Node.isDoStatement(ancestor) ||
        (Node.isBinaryExpression(ancestor) &&
          [
            SyntaxKind.AmpersandAmpersandToken,
            SyntaxKind.BarBarToken,
            SyntaxKind.QuestionQuestionToken,
          ].includes(ancestor.getOperatorToken().getKind())) ||
        ancestor.getKind() === SyntaxKind.CaseClause ||
        ancestor.getKind() === SyntaxKind.DefaultClause,
    );
}

type ParameterTableState = 'empty' | 'non-empty' | 'unknown';

function unwrapStaticExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * Prove only immutable, local array literals. Imported values and calls remain
 * unknown: their runtime cardinality can change without changing this test file.
 */
function staticParameterTableState(
  input: Node | undefined,
  visited = new Set<Node>(),
): ParameterTableState {
  if (input === undefined) return 'unknown';
  const node = unwrapStaticExpression(input);
  if (visited.has(node)) return 'unknown';
  const path = new Set(visited);
  path.add(node);

  if (Node.isArrayLiteralExpression(node)) {
    let hasUnknownSpread = false;
    for (const element of node.getElements()) {
      if (!Node.isSpreadElement(element)) return 'non-empty';
      const spreadState = staticParameterTableState(element.getExpression(), path);
      if (spreadState === 'non-empty') return 'non-empty';
      if (spreadState === 'unknown') hasUnknownSpread = true;
    }
    return hasUnknownSpread ? 'unknown' : 'empty';
  }

  if (Node.isIdentifier(node)) {
    const declarations = node.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length !== 1 || !Node.isVariableDeclaration(declarations[0])) {
      return 'unknown';
    }
    const declaration = declarations[0];
    if (
      declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const
    ) {
      return 'unknown';
    }
    return staticParameterTableState(declaration.getInitializer(), path);
  }

  return 'unknown';
}

function parameterTableState(
  call: CallExpression,
  modifiers: readonly string[],
): ParameterTableState | undefined {
  if (!modifiers.includes('each') && !modifiers.includes('for')) return undefined;
  const configurator = call.getExpression();
  if (!Node.isCallExpression(configurator)) return 'unknown';
  return staticParameterTableState(configurator.getArguments()[0]);
}

function findTestCallback(call: CallExpression): ArrowFunction | FunctionExpression | undefined {
  return call
    .getArguments()
    .find(
      (argument): argument is ArrowFunction | FunctionExpression =>
        Node.isArrowFunction(argument) || Node.isFunctionExpression(argument),
    );
}

function addRuntimeAnnotationViolations(
  violations: TestPolicyViolation[],
  file: string,
  call: CallExpression,
): void {
  const callback = findTestCallback(call);
  const infoParameter = callback?.getParameters()[1];
  const infoName = infoParameter?.getNameNode();
  if (callback === undefined || infoName === undefined || !Node.isIdentifier(infoName)) return;

  const infoAliases = new Set([infoName.getText()]);
  let foundAlias = true;
  while (foundAlias) {
    foundAlias = false;
    for (const declaration of callback.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (
        Node.isIdentifier(name) &&
        Node.isIdentifier(initializer) &&
        infoAliases.has(initializer.getText()) &&
        !infoAliases.has(name.getText())
      ) {
        infoAliases.add(name.getText());
        foundAlias = true;
      }
    }
  }

  for (const annotationCall of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const chain = invocationChain(annotationCall.getExpression());
    const annotation = chain?.modifiers[0];
    if (
      chain === undefined ||
      !infoAliases.has(chain.root) ||
      annotation === undefined ||
      !RUNTIME_ANNOTATIONS.has(annotation)
    ) {
      continue;
    }
    addViolation(violations, file, annotationCall, annotation);
  }
}

export function analyzeTestSource(file: string, source: string): TestFileAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(file, source);
  const aliases = importedTestAliases(sourceFile);
  const declarations: TestDeclaration[] = [];
  const violations: TestPolicyViolation[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    // In `test.each(cases)('title', fn)`, only the outer invocation declares a
    // test. The inner call configures the declaration and must not be counted.
    const parent = call.getParent();
    if (Node.isCallExpression(parent) && parent.getExpression() === call) continue;

    const chain = invocationChain(call.getExpression());
    if (chain === undefined) continue;
    const namespaceRoot = aliases.namespaces.has(chain.root) ? chain.modifiers[0] : undefined;
    const canonicalRoot =
      namespaceRoot !== undefined && ROOT_IDENTIFIERS.has(namespaceRoot)
        ? namespaceRoot
        : aliases.roots.get(chain.root);
    if (canonicalRoot === undefined) continue;
    const modifiers = namespaceRoot === undefined ? chain.modifiers : chain.modifiers.slice(1);

    const kind = declarationKind(canonicalRoot, modifiers);
    if (kind !== undefined) {
      const tableState = parameterTableState(call, modifiers);
      if (tableState === 'empty') {
        addViolation(violations, file, call, 'empty-parameter-table');
      } else if (tableState === 'unknown') {
        addViolation(violations, file, call, 'dynamic-parameter-table');
      } else {
        declarations.push({
          kind,
          line: call.getStartLineNumber(),
          title: staticTitle(call.getArguments()[0]),
        });
      }

      if (hasConditionalRegistration(call)) {
        addViolation(violations, file, call, 'conditional-registration');
      }

      if (kind === 'test') {
        for (const argument of call.getArguments()) {
          if (!Node.isObjectLiteralExpression(argument)) continue;
          for (const property of argument.getProperties()) {
            const name = propertyName(property);
            if (name === 'retry' || name === 'repeats') {
              addViolation(violations, file, property, name);
            }
          }
        }
        addRuntimeAnnotationViolations(violations, file, call);
      }
    }

    for (const modifier of modifiers) {
      if (!FORBIDDEN_MODIFIERS.has(modifier)) continue;
      addViolation(violations, file, call, modifier, `.${modifier}`);
    }
  }

  return { declarations, violations };
}
