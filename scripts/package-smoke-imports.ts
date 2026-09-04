/**
 * Import the installed package the way consumers do: every declared export
 * specifier is loaded under both ESM and CommonJS, and a named function from
 * each surface is asserted so an entry that resolves but exports nothing still
 * fails. Codegen specifiers run in the consumer that provisioned the peer.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CODEGEN_EXPORT_NAMES, findExecutableBinFailures } from './package-smoke-manifest';
import { detailFor, exists, isRecord, run, type JsonRecord } from './package-smoke-support';

function packageSpecifier(name: string, exportName: string): string {
  return exportName === '.' ? name : `${name}/${exportName.slice(2)}`;
}

function conditionTarget(value: unknown, condition: 'import' | 'require'): string | undefined {
  if (!isRecord(value)) return undefined;
  const branch = value[condition];
  if (typeof branch === 'string') return branch;
  if (!isRecord(branch)) return undefined;
  return typeof branch['default'] === 'string' ? branch['default'] : undefined;
}

interface SpecifierPartition {
  readonly runtimeEsm: readonly string[];
  readonly codegenEsm: readonly string[];
  readonly runtimeCjs: readonly string[];
  readonly codegenCjs: readonly string[];
}

function partitionExportSpecifiers(
  exportsValue: JsonRecord,
  packageName: string,
): SpecifierPartition {
  const runtimeEsm: string[] = [];
  const codegenEsm: string[] = [];
  const runtimeCjs: string[] = [];
  const codegenCjs: string[] = [];
  for (const [exportName, conditions] of Object.entries(exportsValue)) {
    if (conditionTarget(conditions, 'import') !== undefined) {
      const target = CODEGEN_EXPORT_NAMES.has(exportName) ? codegenEsm : runtimeEsm;
      target.push(packageSpecifier(packageName, exportName));
    }
    if (conditionTarget(conditions, 'require') !== undefined) {
      const target = CODEGEN_EXPORT_NAMES.has(exportName) ? codegenCjs : runtimeCjs;
      target.push(packageSpecifier(packageName, exportName));
    }
  }
  return { runtimeEsm, codegenEsm, runtimeCjs, codegenCjs };
}

/** The Astro integration reads a virtual options module that only a bundler provides. */
async function writeVirtualModuleLoader(consumer: string): Promise<string> {
  const loader = resolve(consumer, 'virtual-module-loader.mjs');
  await writeFile(
    loader,
    [
      'const VIRTUAL_OPTIONS = "virtual:payload-live-preview/options";',
      'const VIRTUAL_URL = "data:text/javascript,export default {defaults:\\"v1\\"};";',
      'export function resolve(specifier, context, nextResolve) {',
      '  if (specifier === VIRTUAL_OPTIONS) return { url: VIRTUAL_URL, shortCircuit: true };',
      '  return nextResolve(specifier, context);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  return loader;
}

function esmProbeSource(
  expected: Readonly<Record<string, readonly string[]>>,
  specifiers: readonly string[],
): string {
  return `const expected = ${JSON.stringify(expected)}; for (const specifier of ${JSON.stringify(specifiers)}) { const namespace = await import(specifier); if (typeof namespace !== 'object' || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`;
}

function cjsProbeSource(
  expected: Readonly<Record<string, readonly string[]>>,
  specifiers: readonly string[],
): string {
  return `const expected = ${JSON.stringify(expected)}; for (const specifier of ${JSON.stringify(specifiers)}) { const namespace = require(specifier); if ((typeof namespace !== 'object' && typeof namespace !== 'function') || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`;
}

function esmRuntimeExports(packageName: string): Readonly<Record<string, readonly string[]>> {
  return {
    [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'createPreviewFocusReporter'],
    [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
    [packageSpecifier(packageName, './astro')]: ['livePreview', 'createLivePreviewMiddleware'],
    [packageSpecifier(packageName, './nextjs')]: ['createLivePreviewMiddleware'],
    [packageSpecifier(packageName, './sveltekit')]: ['livePreviewHandle'],
    [packageSpecifier(packageName, './nuxt')]: ['livePreviewNitroPlugin'],
    [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
    [packageSpecifier(packageName, './server')]: ['definePreview', 'authorizePreviewRequest'],
    [packageSpecifier(packageName, './client')]: [
      'LivePreviewClient',
      'createPreviewFocusReporter',
    ],
    [packageSpecifier(packageName, './structural')]: [
      'createStructuralArrayRenderer',
      'morphElement',
    ],
    [packageSpecifier(packageName, './lexical')]: ['lexicalToHtml', 'isLexicalContent'],
    [packageSpecifier(packageName, './plugins')]: ['PluginManager', 'createAnalyticsPlugin'],
    [packageSpecifier(packageName, './fragment')]: [
      'createFragmentStrategy',
      'parseFragmentResponse',
    ],
    [packageSpecifier(packageName, './astro/middleware-entry')]: ['onRequest'],
  };
}

function cjsRuntimeExports(packageName: string): Readonly<Record<string, readonly string[]>> {
  return {
    [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'createPreviewFocusReporter'],
    [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
    [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
    [packageSpecifier(packageName, './server')]: ['definePreview', 'authorizePreviewRequest'],
    [packageSpecifier(packageName, './client')]: [
      'LivePreviewClient',
      'createPreviewFocusReporter',
    ],
    [packageSpecifier(packageName, './structural')]: [
      'createStructuralArrayRenderer',
      'morphElement',
    ],
    [packageSpecifier(packageName, './lexical')]: ['lexicalToHtml', 'isLexicalContent'],
    [packageSpecifier(packageName, './plugins')]: ['PluginManager', 'createAnalyticsPlugin'],
    [packageSpecifier(packageName, './fragment')]: [
      'createFragmentStrategy',
      'parseFragmentResponse',
    ],
  };
}

function codegenBinary(codegenConsumer: string): string {
  return process.platform === 'win32'
    ? resolve(codegenConsumer, 'node_modules/.bin/pll-codegen.cmd')
    : resolve(codegenConsumer, 'node_modules/.bin/pll-codegen');
}

async function checkPackedCli(
  codegenConsumer: string,
  codegenPackageRoot: string,
  manifestValue: JsonRecord,
): Promise<readonly string[]> {
  const binValue = manifestValue['bin'];
  if (!isRecord(binValue) || typeof binValue['pll-codegen'] !== 'string') {
    return ['manifest does not declare the pll-codegen binary'];
  }

  const failures: string[] = [];
  const cli = run(codegenBinary(codegenConsumer), ['--help'], codegenConsumer);
  if (cli.status !== 0 || !cli.stdout.includes('Usage:')) {
    failures.push(`packed CLI --help smoke failed:\n${detailFor(cli)}`);
  }

  const cliConfig = resolve(codegenConsumer, 'payload.config.ts');
  const cliOutput = resolve(codegenConsumer, 'generated-payload-types.ts');
  await writeFile(
    cliConfig,
    `export default { globals: [{ slug: 'homepage', fields: [{ name: 'title', type: 'text' }] }], collections: [] };\n`,
    'utf8',
  );
  const generation = run(
    codegenBinary(codegenConsumer),
    ['--config', cliConfig, '--out', cliOutput, '--quiet'],
    codegenConsumer,
  );
  if (generation.status !== 0 || !(await exists(cliOutput))) {
    failures.push(`packed CLI generation smoke failed:\n${detailFor(generation)}`);
  } else {
    const generated = await readFile(cliOutput, 'utf8');
    if (!generated.includes('export interface Homepage') || !generated.includes('title?: string')) {
      failures.push('packed CLI generated an unexpected type surface');
    }
  }

  failures.push(...(await findExecutableBinFailures(codegenPackageRoot, binValue['pll-codegen'])));
  return failures;
}

export async function checkPackedImportSmokes(inputs: {
  readonly consumer: string;
  readonly codegenConsumer: string;
  readonly codegenPackageRoot: string;
  readonly packageName: string;
  readonly manifestValue: JsonRecord;
}): Promise<readonly string[]> {
  const exportsValue = inputs.manifestValue['exports'];
  if (!isRecord(exportsValue)) throw new Error('packed package.json has no exports map');
  const specifiers = partitionExportSpecifiers(exportsValue, inputs.packageName);
  const loader = await writeVirtualModuleLoader(inputs.consumer);

  const esmCodegenExports: Readonly<Record<string, readonly string[]>> = {
    [packageSpecifier(inputs.packageName, './codegen')]: ['generateTypes'],
    [packageSpecifier(inputs.packageName, './migrate')]: ['migrateSource', 'CODEMODS'],
    [packageSpecifier(inputs.packageName, './codegen/astro')]: ['livePreviewCodegen'],
  };
  const cjsCodegenExports: Readonly<Record<string, readonly string[]>> = {
    [packageSpecifier(inputs.packageName, './codegen')]: ['generateTypes'],
  };

  const failures: string[] = [];
  const esm = run(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-loader',
      loader,
      '--input-type=module',
      '--eval',
      esmProbeSource(esmRuntimeExports(inputs.packageName), specifiers.runtimeEsm),
    ],
    inputs.consumer,
  );
  if (esm.status !== 0) {
    failures.push(`peer-free ESM import smoke failed:\n${detailFor(esm)}`);
  }

  const codegenEsm = run(
    process.execPath,
    ['--input-type=module', '--eval', esmProbeSource(esmCodegenExports, specifiers.codegenEsm)],
    inputs.codegenConsumer,
  );
  if (codegenEsm.status !== 0) {
    failures.push(`peer-provisioned ESM codegen smoke failed:\n${detailFor(codegenEsm)}`);
  }

  const cjs = run(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      cjsProbeSource(cjsRuntimeExports(inputs.packageName), specifiers.runtimeCjs),
    ],
    inputs.consumer,
  );
  if (cjs.status !== 0) {
    failures.push(`peer-free CommonJS import smoke failed:\n${detailFor(cjs)}`);
  }

  const codegenCjs = run(
    process.execPath,
    ['--input-type=commonjs', '--eval', cjsProbeSource(cjsCodegenExports, specifiers.codegenCjs)],
    inputs.codegenConsumer,
  );
  if (codegenCjs.status !== 0) {
    failures.push(`peer-provisioned CommonJS codegen smoke failed:\n${detailFor(codegenCjs)}`);
  }

  failures.push(
    ...(await checkPackedCli(
      inputs.codegenConsumer,
      inputs.codegenPackageRoot,
      inputs.manifestValue,
    )),
  );
  return failures;
}
