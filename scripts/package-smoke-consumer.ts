/**
 * Isolated npm consumers for the packed-package gate. They are created in the
 * operating system temporary directory so Node cannot satisfy undeclared
 * imports from maintainer `node_modules`, and every install runs under npm's
 * strict script policy with no bypass.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { detailFor, run, type CommandResult } from './package-smoke-support';
import {
  PACKAGE_SMOKE_INSTALL_ARGS,
  PACKAGE_SMOKE_NPMRC,
  PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS,
  sanitizeNpmScriptEnvironment,
} from './release-contracts';

export async function initializeConsumer(
  consumer: string,
  dependencies?: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(consumer, { recursive: true });
  const manifest = {
    private: true,
    type: 'module',
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
  await Promise.all([
    writeFile(resolve(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(resolve(consumer, '.npmrc'), PACKAGE_SMOKE_NPMRC, 'utf8'),
  ]);

  const persistedPolicy = await readFile(resolve(consumer, '.npmrc'), 'utf8');
  if (persistedPolicy !== PACKAGE_SMOKE_NPMRC) {
    throw new Error('isolated consumer npm policy was not written exactly');
  }
  for (const [name, expected] of [
    ['strict-allow-scripts', 'true'],
    ['ignore-scripts', 'false'],
    ['dangerously-allow-all-scripts', 'false'],
  ] as const) {
    const configured = run(
      'npm',
      ['config', 'get', name],
      consumer,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (configured.status !== 0 || configured.stdout.trim() !== expected) {
      throw new Error(
        `isolated consumer npm policy ${name} is not ${expected}:\n${detailFor(configured)}`,
      );
    }
  }
}

export function installStrictly(
  consumer: string,
  packageArguments: readonly string[],
): CommandResult {
  return run(
    'npm',
    ['install', ...PACKAGE_SMOKE_INSTALL_ARGS, ...packageArguments],
    consumer,
    sanitizeNpmScriptEnvironment(process.env),
  );
}

export function bootstrapDeclaredPeersStrictly(consumer: string): CommandResult {
  return run(
    'npm',
    ['install', ...PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS],
    consumer,
    sanitizeNpmScriptEnvironment(process.env),
  );
}

export function probeUnavailableDependencies(
  consumer: string,
  packageNames: readonly string[],
): CommandResult {
  const source = [
    "import { createRequire } from 'node:module';",
    `const localRequire = createRequire(${JSON.stringify(resolve(consumer, 'resolution-probe.cjs'))});`,
    `for (const name of ${JSON.stringify(packageNames)}) {`,
    '  try {',
    '    console.error(`${name} unexpectedly resolved to ${localRequire.resolve(name)}`);',
    '    process.exitCode = 1;',
    '  } catch (error) {',
    "    if (error === null || typeof error !== 'object' || error.code !== 'MODULE_NOT_FOUND') throw error;",
    '  }',
    '}',
  ].join('\n');
  return run(process.execPath, ['--input-type=module', '--eval', source], consumer);
}

export function probeLocalDependency(consumer: string, packageName: string): CommandResult {
  const source = [
    "import { createRequire } from 'node:module';",
    "import { relative, resolve, sep } from 'node:path';",
    `const localRequire = createRequire(${JSON.stringify(resolve(consumer, 'resolution-probe.cjs'))});`,
    `const installedRoot = resolve(${JSON.stringify(consumer)}, 'node_modules');`,
    `const resolved = localRequire.resolve(${JSON.stringify(packageName)});`,
    'const fromInstalledRoot = relative(installedRoot, resolved);',
    "if (fromInstalledRoot === '..' || fromInstalledRoot.startsWith(`..${sep}`)) {",
    '  throw new Error(`${resolved} is outside the isolated consumer node_modules`);',
    '}',
  ].join('\n');
  return run(process.execPath, ['--input-type=module', '--eval', source], consumer);
}
