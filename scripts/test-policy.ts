/**
 * Static test policy and deterministic inventory generation.
 *
 * Runner flags catch focused tests at execution time. This scanner additionally
 * makes skips, todos, expected failures and focused declarations a zero-budget
 * repository contract, including suites that are not selected by a given run.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const TEST_FILE_PATTERN = /\.(?:test|spec|bench)\.[cm]?[jt]sx?$/u;
const RUNNER_CONFIGS = [
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
export type TestGroup = 'benchmarks' | 'e2e' | 'integration' | 'real-payload' | 'soak' | 'unit';

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

export interface TestInventoryFile {
  readonly path: string;
  readonly group: TestGroup;
  readonly suites: number;
  readonly tests: number;
  readonly benchmarks: number;
}

export interface TestInventoryGroup {
  readonly files: number;
  readonly suites: number;
  readonly tests: number;
  readonly benchmarks: number;
}

export interface TestInventory {
  readonly schemaVersion: 1;
  readonly policy: {
    readonly focused: 0;
    readonly skipped: 0;
    readonly todo: 0;
    readonly expectedFailure: 0;
  };
  readonly runnerConfigs: readonly string[];
  readonly totals: TestInventoryGroup;
  readonly groups: Readonly<Record<TestGroup, TestInventoryGroup>>;
  readonly files: readonly TestInventoryFile[];
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

function hasConditionalRegistration(call: CallExpression): boolean {
  return call
    .getAncestors()
    .some(
      (ancestor) =>
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

async function discoverTestFiles(directory: string): Promise<readonly string[]> {
  const discovered: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) discovered.push(...(await discoverTestFiles(path)));
    else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) discovered.push(path);
  }
  return discovered;
}

export function groupForFile(path: string): TestGroup | undefined {
  if (path.startsWith('tests/benchmarks/')) return 'benchmarks';
  if (path.startsWith('tests/e2e/')) return 'e2e';
  if (path.startsWith('tests/integration/')) return 'integration';
  if (path.startsWith('tests/real-payload/')) return 'real-payload';
  if (path.startsWith('tests/soak/')) return 'soak';
  if (path.startsWith('tests/unit/')) return 'unit';
  return undefined;
}

export function findStrykerVitestConfigViolations(
  strykerSource: string,
  vitestSource: string,
): readonly string[] {
  const violations: string[] = [];
  if (!/configFile:\s*['"]vitest\.stryker\.config\.ts['"]/u.test(strykerSource)) {
    violations.push('Stryker must use vitest.stryker.config.ts');
  }

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('vitest.stryker.config.ts', vitestSource);
  const importsBase = sourceFile
    .getImportDeclarations()
    .some((declaration) => declaration.getModuleSpecifierValue() === './vitest.config');
  if (!importsBase) violations.push('dedicated config must import the base Vitest config');

  const defineCall = sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => call.getExpression().getText() === 'defineConfig');
  const root = defineCall?.getArguments()[0];
  if (root === undefined || !Node.isObjectLiteralExpression(root)) {
    return [...violations, 'dedicated config must export defineConfig with an object'];
  }

  const rootKeys = root.getProperties().map((property) => {
    if (Node.isSpreadAssignment(property)) return `...${property.getExpression().getText()}`;
    return propertyName(property) ?? '<unsupported>';
  });
  if (rootKeys.length !== 2 || !rootKeys.includes('...base') || !rootKeys.includes('test')) {
    violations.push('dedicated config may only inherit base and override test reporters');
  }

  const testProperty = root
    .getProperties()
    .find((property) => Node.isPropertyAssignment(property) && property.getName() === 'test');
  const testObject =
    testProperty !== undefined && Node.isPropertyAssignment(testProperty)
      ? testProperty.getInitializer()
      : undefined;
  if (testObject === undefined || !Node.isObjectLiteralExpression(testObject)) {
    return [...violations, 'dedicated config must override a test object'];
  }

  const testKeys = testObject.getProperties().map((property) => {
    if (Node.isSpreadAssignment(property)) return `...${property.getExpression().getText()}`;
    return propertyName(property) ?? '<unsupported>';
  });
  if (
    testKeys.length !== 2 ||
    !testKeys.includes('...base.test') ||
    !testKeys.includes('reporters')
  ) {
    violations.push('dedicated config test override may only replace reporters after base.test');
  }

  const reporters = testObject
    .getProperties()
    .find((property) => Node.isPropertyAssignment(property) && property.getName() === 'reporters');
  if (
    reporters === undefined ||
    !Node.isPropertyAssignment(reporters) ||
    reporters.getInitializer()?.getText() !== "['default']"
  ) {
    violations.push('dedicated config must use only the default reporter');
  }
  return violations;
}

function emptyGroup(): TestInventoryGroup {
  return { files: 0, suites: 0, tests: 0, benchmarks: 0 };
}

function addFileToGroup(
  group: TestInventoryGroup,
  file: Pick<TestInventoryFile, 'benchmarks' | 'suites' | 'tests'>,
): TestInventoryGroup {
  return {
    files: group.files + 1,
    suites: group.suites + file.suites,
    tests: group.tests + file.tests,
    benchmarks: group.benchmarks + file.benchmarks,
  };
}

export async function buildTestInventory(repositoryRoot: string): Promise<{
  readonly inventory: TestInventory;
  readonly violations: readonly TestPolicyViolation[];
}> {
  const absoluteFiles = await discoverTestFiles(resolve(repositoryRoot, 'tests'));
  await Promise.all(RUNNER_CONFIGS.map((path) => readFile(resolve(repositoryRoot, path), 'utf8')));
  const files: TestInventoryFile[] = [];
  const violations: TestPolicyViolation[] = [];

  for (const absoluteFile of absoluteFiles) {
    const path = relative(repositoryRoot, absoluteFile).replaceAll('\\', '/');
    const analysis = analyzeTestSource(path, await readFile(absoluteFile, 'utf8'));
    const group = groupForFile(path);
    if (group === undefined) {
      throw new Error(`${path} is not owned by a configured test runner`);
    }
    const entry: TestInventoryFile = {
      path,
      group,
      suites: analysis.declarations.filter(({ kind }) => kind === 'suite').length,
      tests: analysis.declarations.filter(({ kind }) => kind === 'test').length,
      benchmarks: analysis.declarations.filter(({ kind }) => kind === 'benchmark').length,
    };
    files.push(entry);
    violations.push(...analysis.violations);
  }

  const groups: Record<TestGroup, TestInventoryGroup> = {
    benchmarks: emptyGroup(),
    e2e: emptyGroup(),
    integration: emptyGroup(),
    'real-payload': emptyGroup(),
    soak: emptyGroup(),
    unit: emptyGroup(),
  };
  let totals = emptyGroup();
  for (const file of files) {
    groups[file.group] = addFileToGroup(groups[file.group], file);
    totals = addFileToGroup(totals, file);
  }

  return {
    inventory: {
      schemaVersion: 1,
      policy: { focused: 0, skipped: 0, todo: 0, expectedFailure: 0 },
      runnerConfigs: RUNNER_CONFIGS,
      totals,
      groups,
      files,
    },
    violations,
  };
}

export function serializeTestInventory(inventory: TestInventory): string {
  return `${JSON.stringify(inventory, undefined, 2)}\n`;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const inventoryPath = resolve(repositoryRoot, 'quality/test-inventory.json');
  const shouldWrite = process.argv.includes('--write');
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--write');
  if (unknownArguments.length > 0) {
    throw new Error(`unknown arguments: ${unknownArguments.join(', ')}`);
  }

  const { inventory, violations } = await buildTestInventory(repositoryRoot);
  if (violations.length > 0) {
    throw new Error(
      `test policy failed:\n${violations.map(({ message }) => `- ${message}`).join('\n')}`,
    );
  }

  const serialized = serializeTestInventory(inventory);
  if (shouldWrite) {
    await writeFile(inventoryPath, serialized);
    console.log(
      `Wrote ${relative(repositoryRoot, inventoryPath)} (${String(inventory.totals.files)} files).`,
    );
    return;
  }

  const committed = await readFile(inventoryPath, 'utf8');
  if (committed !== serialized) {
    throw new Error('test inventory is stale; run: tsx scripts/test-policy.ts --write');
  }
  console.log(
    `Test policy passed: ${String(inventory.totals.files)} files, ${String(inventory.totals.tests)} test declarations, zero skips/focus/todos/expected failures.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
