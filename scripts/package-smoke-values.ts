/**
 * Every name a packed declaration offers as a value exists when its entry is
 * loaded under the same condition. The declaration bundler marks an export
 * `type` by the kind of its declaration, not by how the source exported it, so
 * a class exported with `type` came out as a value: 2.3.0 typed
 * `new DocumentSession()` from `/core`, a module that never exported it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createProgram,
  flattenDiagnosticMessageText,
  isImportDeclaration,
  isNamespaceImport,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
} from 'typescript';
import type { TypedApiEntry } from './api-contracts';
import { detailFor, run } from './package-smoke-support';

export interface DeclaredValueTarget {
  readonly entry: TypedApiEntry;
  /** The consumer that installed the archive with the peers this entry loads. */
  readonly consumer: string;
}

interface Probe {
  readonly consumer: string;
  readonly specifier: string;
  readonly condition: 'import' | 'require';
  readonly file: string;
}

// The specifiers arrive as arguments, so no value is spliced into code.
const ESM_KEYS =
  'const keys = {}; for (const specifier of process.argv.slice(1)) keys[specifier] = Object.keys(await import(specifier)); console.log(JSON.stringify(keys));';
const CJS_KEYS =
  'const keys = {}; for (const specifier of process.argv.slice(1)) keys[specifier] = Object.keys(require(specifier)); console.log(JSON.stringify(keys));';

function specifierFor(packageName: string, exportName: string): string {
  return exportName === '.' ? packageName : `${packageName}/${exportName.slice(2)}`;
}

async function writeProbes(
  targets: readonly DeclaredValueTarget[],
  packageName: string,
): Promise<readonly Probe[]> {
  const probes: Probe[] = [];
  for (const [index, { entry, consumer }] of targets.entries()) {
    const directory = resolve(consumer, 'declared-value-probes');
    await mkdir(directory, { recursive: true });
    const specifier = specifierFor(packageName, entry.exportName);
    const conditions = entry.requireTypesTarget === undefined ? ['import'] : ['import', 'require'];
    for (const condition of conditions as readonly ('import' | 'require')[]) {
      // The extension picks the condition NodeNext resolves the specifier under.
      const file = resolve(directory, `${String(index)}.${condition === 'import' ? 'mts' : 'cts'}`);
      await writeFile(
        file,
        `import * as namespace from ${JSON.stringify(specifier)};\nexport type { namespace };\n`,
        'utf8',
      );
      probes.push({ consumer, specifier, condition, file });
    }
  }
  return probes;
}

/** The names a strict NodeNext consumer may read from each probe's namespace import. */
function declaredValues(
  probes: readonly Probe[],
  failures: string[],
): ReadonlyMap<Probe, readonly string[]> {
  const program = createProgram(
    probes.map((probe) => probe.file),
    {
      module: ModuleKind.NodeNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
      target: ScriptTarget.ES2022,
      strict: true,
      noEmit: true,
      // The strict type smoke checks the declarations themselves.
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker();
  const values = new Map<Probe, readonly string[]>();
  for (const probe of probes) {
    const source = program.getSourceFile(probe.file);
    const statement = source?.statements[0];
    const bindings =
      statement !== undefined && isImportDeclaration(statement)
        ? statement.importClause?.namedBindings
        : undefined;
    const namespace =
      bindings !== undefined && isNamespaceImport(bindings)
        ? checker.getSymbolAtLocation(bindings.name)
        : undefined;
    const diagnostics = source === undefined ? [] : program.getSemanticDiagnostics(source);
    if (namespace === undefined || diagnostics.length > 0) {
      const messages = diagnostics.map((d) => flattenDiagnosticMessageText(d.messageText, ' '));
      failures.push(
        `${probe.specifier} (${probe.condition}): the declarations do not resolve: ${messages.join('; ')}`,
      );
      continue;
    }
    // A namespace object's type holds exactly the value exports: an interface,
    // a type alias and a class exported with `type` are not among its properties.
    const properties = checker.getPropertiesOfType(checker.getTypeOfSymbol(namespace));
    values.set(
      probe,
      properties.map((property) => property.name),
    );
  }
  return values;
}

function runtimeKeys(
  consumer: string,
  condition: Probe['condition'],
  specifiers: readonly string[],
  loader: string,
): Readonly<Record<string, readonly string[]>> | string {
  const args =
    condition === 'import'
      ? [
          '--no-warnings',
          '--experimental-loader',
          loader,
          '--input-type=module',
          '--eval',
          ESM_KEYS,
        ]
      : ['--eval', CJS_KEYS];
  const result = run(process.execPath, [...args, ...specifiers], consumer);
  if (result.status !== 0) return detailFor(result);
  return JSON.parse(result.stdout) as Record<string, readonly string[]>;
}

export async function checkDeclaredValuesExist(inputs: {
  readonly targets: readonly DeclaredValueTarget[];
  readonly packageName: string;
  /** Resolves the virtual module the Astro entries import, which only a bundler provides. */
  readonly loader: string;
}): Promise<readonly string[]> {
  const failures: string[] = [];
  const probes = await writeProbes(inputs.targets, inputs.packageName);
  const declared = declaredValues(probes, failures);
  const groups = new Map<string, Probe[]>();
  for (const probe of probes) {
    const key = `${probe.condition} ${probe.consumer}`;
    groups.set(key, [...(groups.get(key) ?? []), probe]);
  }
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    const keys = runtimeKeys(
      first.consumer,
      first.condition,
      group.map((probe) => probe.specifier),
      inputs.loader,
    );
    if (typeof keys === 'string') {
      failures.push(`loading the entries under ${first.condition} failed:\n${keys}`);
      continue;
    }
    for (const probe of group) {
      const present = new Set(keys[probe.specifier] ?? []);
      const missing = (declared.get(probe) ?? []).filter((name) => !present.has(name));
      if (missing.length > 0) {
        failures.push(
          `${probe.specifier} (${probe.condition}) declares ${missing.join(', ')} as a value, but the module does not export it`,
        );
      }
    }
  }
  return failures;
}
