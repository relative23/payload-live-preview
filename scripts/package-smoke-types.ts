/**
 * Strict NodeNext type contracts compiled against the installed package.
 * Positive and negative fixtures are compiled from both `.mts` and `.cts`
 * so a declaration that only resolves under one module system is caught,
 * and `skipLibCheck` stays off so the shipped declarations are checked too.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  detailFor,
  ROOT,
  run,
  TYPE_CONTRACT_ROOT,
  type CommandResult,
} from './package-smoke-support';

interface TypeContractSources {
  readonly positiveEsm: string;
  readonly negativeEsm: string;
  readonly positiveCjs: string;
  readonly negativeCjs: string;
}

async function writeTypeProject(
  consumer: string,
  directory: string,
  sources: TypeContractSources,
): Promise<void> {
  const typeRoot = resolve(consumer, directory);
  await mkdir(typeRoot, { recursive: true });

  await Promise.all([
    writeFile(resolve(typeRoot, 'positive.mts'), sources.positiveEsm, 'utf8'),
    writeFile(resolve(typeRoot, 'negative.mts'), sources.negativeEsm, 'utf8'),
    writeFile(resolve(typeRoot, 'positive.cts'), sources.positiveCjs, 'utf8'),
    writeFile(resolve(typeRoot, 'negative.cts'), sources.negativeCjs, 'utf8'),
    writeFile(
      resolve(typeRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
          },
          include: ['./*.mts', './*.cts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);
}

async function readTypeContract(fileName: string, packageName: string): Promise<string> {
  const source = await readFile(resolve(TYPE_CONTRACT_ROOT, fileName), 'utf8');
  return source.replaceAll('payload-live-preview', packageName);
}

async function writeTypeSmoke(
  consumer: string,
  packageName: string,
  prefix: string,
  directory: string,
): Promise<void> {
  const [positiveEsm, negativeEsm, positiveCjs, negativeCjs] = await Promise.all([
    readTypeContract(`${prefix}-positive.mts.fixture`, packageName),
    readTypeContract(`${prefix}-negative.mts.fixture`, packageName),
    readTypeContract(`${prefix}-positive.cts.fixture`, packageName),
    readTypeContract(`${prefix}-negative.cts.fixture`, packageName),
  ]);
  await writeTypeProject(consumer, directory, {
    positiveEsm,
    negativeEsm,
    positiveCjs,
    negativeCjs,
  });
}

function typecheck(consumer: string, project: string): CommandResult {
  return run(
    process.execPath,
    [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--project', project],
    consumer,
  );
}

export async function checkPackedTypeContracts(consumers: {
  readonly runtime: string;
  readonly codegen: string;
  readonly packageName: string;
}): Promise<readonly string[]> {
  const failures: string[] = [];

  await writeTypeSmoke(
    consumers.runtime,
    consumers.packageName,
    'runtime',
    'runtime-type-contracts',
  );
  const runtimeTypecheck = typecheck(consumers.runtime, 'runtime-type-contracts/tsconfig.json');
  if (runtimeTypecheck.status !== 0) {
    failures.push(
      `peer-free strict NodeNext ESM/CommonJS type smoke failed:\n${detailFor(runtimeTypecheck)}`,
    );
  }

  await writeTypeSmoke(
    consumers.codegen,
    consumers.packageName,
    'codegen',
    'codegen-type-contracts',
  );
  const codegenTypecheck = typecheck(consumers.codegen, 'codegen-type-contracts/tsconfig.json');
  if (codegenTypecheck.status !== 0) {
    failures.push(
      `peer-provisioned strict NodeNext codegen type smoke failed:\n${detailFor(codegenTypecheck)}`,
    );
  }

  return failures;
}
