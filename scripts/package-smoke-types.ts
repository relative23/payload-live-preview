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

async function writePayloadPluginTypeSmoke(
  consumer: string,
  packageName: string,
  fixture: string,
  payload2ConfigPointer: boolean,
): Promise<string> {
  const directory = 'payload-plugin-type-contracts';
  const typeRoot = resolve(consumer, directory);
  await mkdir(typeRoot, { recursive: true });

  // These consumers expose the exact published Payload archive without its
  // dependency declarations so none of their lifecycle scripts can run.
  // `skipLibCheck` ignores only those absent upstream declarations; the strict
  // fixture boundary still checks this package's Plugin assignability.
  const source = await readTypeContract(fixture, packageName);
  await Promise.all([
    writeFile(resolve(typeRoot, 'positive.mts'), source, 'utf8'),
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
            skipLibCheck: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            ...(payload2ConfigPointer
              ? {
                  // Payload 2 publishes this legacy pointer beside an
                  // `exports: null` manifest that NodeNext will not traverse.
                  baseUrl: '.',
                  paths: {
                    'payload/config': ['../node_modules/payload/config.d.ts'],
                  },
                }
              : {}),
          },
          include: ['./positive.mts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);
  return `${directory}/tsconfig.json`;
}

export async function checkPackedPayloadPluginTypeContracts(consumers: {
  readonly payload2: string;
  readonly payload3: string;
  readonly packageName: string;
}): Promise<readonly string[]> {
  const failures: string[] = [];
  const targets = [
    {
      consumer: consumers.payload2,
      fixture: 'payload-plugin-v2-positive.mts.fixture',
      label: 'Payload 2.32.3',
      payload2ConfigPointer: true,
    },
    {
      consumer: consumers.payload3,
      fixture: 'payload-plugin-v3-positive.mts.fixture',
      label: 'Payload 3.89.0',
      payload2ConfigPointer: false,
    },
  ] as const;

  for (const target of targets) {
    const project = await writePayloadPluginTypeSmoke(
      target.consumer,
      consumers.packageName,
      target.fixture,
      target.payload2ConfigPointer,
    );
    const result = typecheck(target.consumer, project);
    if (result.status !== 0) {
      failures.push(
        `${target.label} packed plugin type compatibility failed:\n${detailFor(result)}`,
      );
    }
  }

  return failures;
}
