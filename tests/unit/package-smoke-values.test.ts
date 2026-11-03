import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { TypedApiEntry } from '../../scripts/api-contracts';
import { checkDeclaredValuesExist } from '../../scripts/package-smoke-values';

const ENTRY: TypedApiEntry = {
  exportName: '.',
  importTypesTarget: './index.d.ts',
  requireTypesTarget: './index.d.cts',
  reportName: 'example-package',
};

// What the module exports at runtime, under both conditions: the factory only.
const ESM_SOURCE = 'class Session {}\nexport function create() { return new Session(); }\n';
const CJS_SOURCE =
  'class Session {}\nexports.create = function create() { return new Session(); };\n';

describe('declared values exist at runtime', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
  });

  async function consumerWith(declaration: string | undefined): Promise<string> {
    const consumer = await mkdtemp(resolve(tmpdir(), 'plp-declared-values-'));
    temporaryRoots.push(consumer);
    const packageRoot = resolve(consumer, 'node_modules/example-package');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      resolve(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'example-package',
        type: 'module',
        exports: {
          '.': {
            import: { types: './index.d.ts', default: './index.js' },
            require: { types: './index.d.cts', default: './index.cjs' },
          },
        },
      }),
    );
    await writeFile(resolve(packageRoot, 'index.js'), ESM_SOURCE);
    await writeFile(resolve(packageRoot, 'index.cjs'), CJS_SOURCE);
    if (declaration !== undefined) {
      await writeFile(resolve(packageRoot, 'index.d.ts'), declaration);
      await writeFile(resolve(packageRoot, 'index.d.cts'), declaration);
    }
    await writeFile(
      resolve(consumer, 'loader.mjs'),
      'export function resolve(specifier, context, nextResolve) { return nextResolve(specifier, context); }\n',
    );
    return consumer;
  }

  async function check(consumer: string): Promise<readonly string[]> {
    return checkDeclaredValuesExist({
      targets: [{ entry: ENTRY, consumer }],
      packageName: 'example-package',
      loader: resolve(consumer, 'loader.mjs'),
    });
  }

  it('fails a class the declarations export as a value that the module does not export', async () => {
    const consumer = await consumerWith(
      'declare class Session { constructor(value: string); }\ndeclare function create(): Session;\nexport { Session, create };\n',
    );

    expect(await check(consumer)).toEqual([
      'example-package (import) declares Session as a value, but the module does not export it',
      'example-package (require) declares Session as a value, but the module does not export it',
    ]);
  });

  it('passes a class exported with type, an interface and a type alias beside the runtime values', async () => {
    const consumer = await consumerWith(
      [
        'declare class Session { constructor(value: string); }',
        'interface Options { readonly a: string }',
        'type Status = "idle" | "live";',
        'declare function create(options?: Options): Session;',
        'export { create };',
        'export type { Options, Session, Status };',
        '',
      ].join('\n'),
    );

    expect(await check(consumer)).toEqual([]);
  });

  it('fails declarations that do not resolve rather than finding no value in them', async () => {
    const consumer = await consumerWith(undefined);

    const failures = await check(consumer);

    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatch(/^example-package \(import\): the declarations do not resolve: /);
    expect(failures[1]).toMatch(/^example-package \(require\): the declarations do not resolve: /);
  });
});
