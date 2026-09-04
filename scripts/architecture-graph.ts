/**
 * Build the executable dependency graph of `src` from static syntax alone.
 * Reading imports with ts-morph instead of a bundler keeps the graph
 * independent of build configuration, and separating runtime from type-only
 * edges is what lets the policy allow erased references across layers.
 */

import { readFile, readdir } from 'node:fs/promises';
import { posix, relative, resolve } from 'node:path';
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
 * Non-code assets (currently the reviewed package.json metadata import) stay
 * outside the executable graph instead of becoming fake layer edges.
 */
export function isInternalSourceSpecifier(specifier: string): boolean {
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
