/** Executable source-layer, server/browser boundary and cycle policy. */

import { readFile, readdir } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Node, Project, SyntaxKind, type ImportDeclaration } from 'ts-morph';

export type DependencyKind = 'runtime' | 'type';

export interface ArchitectureDependency {
  readonly specifier: string;
  readonly target?: string;
  readonly kind: DependencyKind;
}

export interface ArchitectureModule {
  readonly path: string;
  readonly dependencies: readonly ArchitectureDependency[];
}

export type ArchitectureViolationKind =
  | 'browser-node-builtin'
  | 'layer-boundary'
  | 'runtime-cycle'
  | 'server-boundary'
  | 'unresolved-internal';

export interface ArchitectureViolation {
  readonly kind: ArchitectureViolationKind;
  readonly module: string;
  readonly dependency?: string;
  readonly message: string;
}

const SERVER_ONLY_DOMAINS = new Set(['codegen', 'payload']);
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((module) => [
    module,
    module.startsWith('node:') ? module : `node:${module}`,
  ]),
);

/**
 * A layer may depend on domains absent from its deny-list. These rules protect
 * the low-level runtime/security layers from convenient upward imports while
 * allowing type-only references, which are erased and cannot create runtime
 * coupling or cycles.
 */
const FORBIDDEN_RUNTIME_DOMAINS: Readonly<Record<string, ReadonlySet<string>>> = {
  client: new Set(['adapters', 'codegen', 'inline', 'payload']),
  codegen: new Set([
    'adapters',
    'client',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
    'security',
  ]),
  core: new Set(['adapters', 'client', 'codegen', 'inline', 'payload', 'plugins']),
  detection: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
  ]),
  dsl: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'events',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
    'security',
  ]),
  events: new Set([
    'adapters',
    'client',
    'codegen',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
    'security',
  ]),
  'field-types': new Set(['adapters', 'client', 'codegen', 'inline', 'payload', 'plugins']),
  inline: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'lexical',
    'payload',
    'plugins',
    'schema',
    'security',
  ]),
  lexical: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'events',
    'field-types',
    'inline',
    'payload',
    'plugins',
    'schema',
  ]),
  payload: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'plugins',
    'schema',
    'security',
  ]),
  plugins: new Set(['adapters', 'client', 'codegen', 'inline', 'payload']),
  schema: new Set([
    'adapters',
    'client',
    'codegen',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
  ]),
  security: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
  ]),
};

const ALIASES: Readonly<Record<string, string>> = {
  '@': 'src',
  '@adapters': 'src/adapters',
  '@client': 'src/client',
  '@core': 'src/core',
  '@detection': 'src/detection',
  '@dsl': 'src/dsl',
  '@events': 'src/events',
  '@field-types': 'src/field-types',
  '@inline': 'src/inline',
  '@lexical': 'src/lexical',
  '@plugins': 'src/plugins',
  '@schema': 'src/schema',
  '@security': 'src/security',
  '@types': 'src/types',
};

function domainFor(path: string): string {
  const parts = path.split('/');
  if (parts[0] !== 'src') return parts[0] ?? path;
  if (parts.length === 2) return '<entry>';
  return parts[1] ?? '<entry>';
}

function isNodeBuiltin(specifier: string): boolean {
  return NODE_BUILTINS.has(specifier);
}

const REVIEWED_NON_SOURCE_EXTENSIONS = new Set(['.json']);

function aliasPathFor(specifier: string): string | undefined {
  for (const [alias, aliasPath] of Object.entries(ALIASES).sort(
    ([left], [right]) => right.length - left.length,
  )) {
    if (specifier === alias) return aliasPath;
    if (specifier.startsWith(`${alias}/`)) {
      return `${aliasPath}/${specifier.slice(alias.length + 1)}`;
    }
  }
  return undefined;
}

/**
 * Relative source imports and repository aliases must resolve inside the graph.
 * Non-code assets (currently the reviewed package.json metadata import) remain
 * outside the executable dependency graph instead of becoming fake layer edges.
 */
function isInternalSourceSpecifier(specifier: string): boolean {
  if (aliasPathFor(specifier) !== undefined) return true;
  return specifier.startsWith('.') && !REVIEWED_NON_SOURCE_EXTENSIONS.has(posix.extname(specifier));
}

function sourceCandidates(base: string): readonly string[] {
  const extension = posix.extname(base);
  if (extension === '.js') return [base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx'];
  if (extension === '.jsx') return [base.slice(0, -4) + '.tsx'];
  if (extension === '.mjs') return [base.slice(0, -4) + '.mts'];
  if (extension === '.cjs') return [base.slice(0, -4) + '.cts'];
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`,
  ];
}

function resolveInternalSpecifier(
  from: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) {
    base = posix.normalize(posix.join(posix.dirname(from), specifier));
  } else {
    base = aliasPathFor(specifier);
  }
  if (base === undefined) return undefined;

  for (const candidate of sourceCandidates(base)) {
    if (filePaths.has(candidate)) return candidate;
  }
  return undefined;
}

function importKind(declaration: ImportDeclaration): DependencyKind {
  if (declaration.isTypeOnly()) return 'type';
  const namedImports = declaration.getNamedImports();
  if (
    namedImports.length > 0 &&
    declaration.getDefaultImport() === undefined &&
    declaration.getNamespaceImport() === undefined &&
    namedImports.every((namedImport) => namedImport.isTypeOnly())
  ) {
    return 'type';
  }
  return 'runtime';
}

function staticModuleSpecifier(node: Node | undefined): string | undefined {
  if (node !== undefined && Node.isStringLiteral(node)) return node.getLiteralText();
  if (node !== undefined && Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

async function discoverSourceFiles(directory: string): Promise<readonly string[]> {
  const discovered: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) discovered.push(...(await discoverSourceFiles(path)));
    else if (
      entry.isFile() &&
      /\.(?:cts|mts|tsx?)$/u.test(entry.name) &&
      !/\.d\.(?:cts|mts|ts)$/u.test(entry.name)
    ) {
      discovered.push(path);
    }
  }
  return discovered;
}

export async function readArchitectureModules(
  repositoryRoot: string,
): Promise<readonly ArchitectureModule[]> {
  const absoluteFiles = await discoverSourceFiles(resolve(repositoryRoot, 'src'));
  const filePaths = new Set(
    absoluteFiles.map((path) => relative(repositoryRoot, path).replaceAll('\\', '/')),
  );
  const project = new Project({ useInMemoryFileSystem: true });
  const modules: ArchitectureModule[] = [];

  for (const absoluteFile of absoluteFiles) {
    const path = relative(repositoryRoot, absoluteFile).replaceAll('\\', '/');
    const sourceFile = project.createSourceFile(path, await readFile(absoluteFile, 'utf8'));
    const dependencies: ArchitectureDependency[] = [];

    for (const declaration of sourceFile.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      const target = resolveInternalSpecifier(path, specifier, filePaths);
      dependencies.push({
        specifier,
        ...(target === undefined ? {} : { target }),
        kind: importKind(declaration),
      });
    }
    for (const declaration of sourceFile.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier === undefined) continue;
      const target = resolveInternalSpecifier(path, specifier, filePaths);
      dependencies.push({
        specifier,
        ...(target === undefined ? {} : { target }),
        kind: declaration.isTypeOnly() ? 'type' : 'runtime',
      });
    }
    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
      const reference = declaration.getModuleReference();
      if (!Node.isExternalModuleReference(reference)) continue;
      const specifier = staticModuleSpecifier(reference.getExpression());
      if (specifier === undefined) continue;
      const target = resolveInternalSpecifier(path, specifier, filePaths);
      dependencies.push({
        specifier,
        ...(target === undefined ? {} : { target }),
        kind: declaration.isTypeOnly() ? 'type' : 'runtime',
      });
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const isStaticImport = expression.getKind() === SyntaxKind.ImportKeyword;
      const isStaticRequire = Node.isIdentifier(expression) && expression.getText() === 'require';
      if (!isStaticImport && !isStaticRequire) continue;
      const specifier = staticModuleSpecifier(call.getArguments()[0]);
      if (specifier === undefined) continue;
      const target = resolveInternalSpecifier(path, specifier, filePaths);
      dependencies.push({
        specifier,
        ...(target === undefined ? {} : { target }),
        kind: 'runtime',
      });
    }

    modules.push({ path, dependencies });
  }
  return modules;
}

function findRuntimeCycles(
  modules: readonly ArchitectureModule[],
): readonly ArchitectureViolation[] {
  const adjacency = new Map(
    modules.map((module) => [
      module.path,
      module.dependencies
        .filter(
          (dependency): dependency is ArchitectureDependency & { readonly target: string } =>
            dependency.kind === 'runtime' && dependency.target !== undefined,
        )
        .map(({ target }) => target),
    ]),
  );
  const indexByModule = new Map<string, number>();
  const lowLinkByModule = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  let nextIndex = 0;

  const visit = (module: string): void => {
    indexByModule.set(module, nextIndex);
    lowLinkByModule.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);

    for (const dependency of adjacency.get(module) ?? []) {
      if (!indexByModule.has(dependency)) {
        visit(dependency);
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, lowLinkByModule.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, indexByModule.get(dependency)!),
        );
      }
    }

    if (lowLinkByModule.get(module) !== indexByModule.get(module)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== module);

    const sorted = component.sort();
    const selfCycle = sorted.length === 1 && (adjacency.get(sorted[0]!) ?? []).includes(sorted[0]!);
    if (sorted.length > 1 || selfCycle) {
      violations.push({
        kind: 'runtime-cycle',
        module: sorted[0]!,
        message: `runtime import cycle: ${sorted.join(' -> ')}`,
      });
    }
  };

  for (const module of [...adjacency.keys()].sort()) {
    if (!indexByModule.has(module)) visit(module);
  }
  return violations;
}

export function findArchitectureViolations(
  modules: readonly ArchitectureModule[],
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const module of modules) {
    const sourceDomain = domainFor(module.path);
    for (const dependency of module.dependencies) {
      if (dependency.target === undefined && isInternalSourceSpecifier(dependency.specifier)) {
        violations.push({
          kind: 'unresolved-internal',
          module: module.path,
          dependency: dependency.specifier,
          message: `${module.path} has unresolved internal import ${dependency.specifier}`,
        });
      }
      if (dependency.kind === 'type') continue;

      if (isNodeBuiltin(dependency.specifier) && !SERVER_ONLY_DOMAINS.has(sourceDomain)) {
        violations.push({
          kind: 'browser-node-builtin',
          module: module.path,
          dependency: dependency.specifier,
          message: `${module.path} imports Node builtin ${dependency.specifier} outside a server-only entry`,
        });
      }

      if (dependency.target === undefined) continue;
      const targetDomain = domainFor(dependency.target);
      if (!SERVER_ONLY_DOMAINS.has(sourceDomain) && SERVER_ONLY_DOMAINS.has(targetDomain)) {
        violations.push({
          kind: 'server-boundary',
          module: module.path,
          dependency: dependency.target,
          message: `${module.path} imports server-only ${dependency.target}`,
        });
      }
      if (FORBIDDEN_RUNTIME_DOMAINS[sourceDomain]?.has(targetDomain) === true) {
        violations.push({
          kind: 'layer-boundary',
          module: module.path,
          dependency: dependency.target,
          message: `${module.path} crosses the ${sourceDomain} -> ${targetDomain} runtime boundary`,
        });
      }
    }
  }

  violations.push(...findRuntimeCycles(modules));
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const modules = await readArchitectureModules(repositoryRoot);
  const violations = findArchitectureViolations(modules);
  if (violations.length > 0) {
    throw new Error(
      `architecture policy failed:\n${violations.map(({ message }) => `- ${message}`).join('\n')}`,
    );
  }
  const runtimeEdges = modules.reduce(
    (count, module) =>
      count + module.dependencies.filter(({ kind, target }) => kind === 'runtime' && target).length,
    0,
  );
  console.log(
    `Architecture policy passed: ${String(modules.length)} modules, ${String(runtimeEdges)} runtime edges, no layer violations or cycles.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
