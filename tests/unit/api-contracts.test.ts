import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAttwInvocations,
  checkDualDeclarationParity,
  collectTypedApiEntries,
  findForgottenExportBaselineViolation,
} from '../../scripts/api-contracts';

describe('packed API contracts', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
  });

  const manifest = {
    name: 'example-package',
    exports: {
      '.': {
        import: {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
        require: {
          types: './dist/index.d.cts',
          default: './dist/index.cjs',
        },
      },
      './adapter': {
        import: {
          types: './dist/adapter.d.ts',
          default: './dist/adapter.js',
        },
      },
      './asset': './dist/component.astro',
    },
  };

  it('discovers every typed manifest entry and ignores non-TypeScript assets', () => {
    expect(collectTypedApiEntries(manifest)).toEqual([
      {
        exportName: '.',
        importTypesTarget: './dist/index.d.ts',
        reportName: 'example-package',
        requireTypesTarget: './dist/index.d.cts',
      },
      {
        exportName: './adapter',
        importTypesTarget: './dist/adapter.d.ts',
        reportName: 'example-package--adapter',
        requireTypesTarget: undefined,
      },
    ]);
  });

  it('runs both ATTW profiles against the exact same archive', () => {
    const tarball = '/tmp/exact/example-package-1.2.3.tgz';
    const invocations = buildAttwInvocations(tarball, collectTypedApiEntries(manifest));

    expect(invocations).toHaveLength(2);
    expect(invocations.map(({ args }) => args[0])).toEqual([tarball, tarball]);
    expect(invocations).toEqual([
      {
        args: [
          tarball,
          '--profile',
          'node16',
          '--no-definitely-typed',
          '--entrypoints',
          '.',
          '--format',
          'table',
          '--no-color',
        ],
        label: 'dual-format',
      },
      {
        args: [
          tarball,
          '--profile',
          'esm-only',
          '--no-definitely-typed',
          '--entrypoints',
          'adapter',
          '--format',
          'table',
          '--no-color',
        ],
        label: 'ESM-only',
      },
    ]);
  });

  it('rejects declaration targets that can escape the packed package', () => {
    expect(() =>
      collectTypedApiEntries({
        name: 'unsafe-package',
        exports: {
          '.': {
            import: {
              types: './../outside.d.ts',
              default: './dist/index.js',
            },
          },
        },
      }),
    ).toThrow(/unsafe or non-declaration types target/u);
  });

  it('requires an explicit ratchet update whenever forgotten-export debt changes', () => {
    expect(findForgottenExportBaselineViolation(48, 48)).toBeUndefined();
    expect(findForgottenExportBaselineViolation(49, 48)).toMatch(/48 to 49/u);
    expect(findForgottenExportBaselineViolation(47, 48)).toMatch(/48 to 47/u);
  });

  it('rejects drift between import and require declarations from the installed archive', async () => {
    const packageRoot = await mkdtemp(resolve(tmpdir(), 'plp-api-parity-'));
    temporaryRoots.push(packageRoot);
    await mkdir(resolve(packageRoot, 'dist'));
    await writeFile(
      resolve(packageRoot, 'dist/index.d.ts'),
      'export declare const value: string;\n',
    );
    await writeFile(
      resolve(packageRoot, 'dist/index.d.cts'),
      'export declare const value: number;\n',
    );
    const entries = collectTypedApiEntries(manifest);

    await expect(checkDualDeclarationParity(entries, () => packageRoot)).resolves.toEqual([
      '. import/require declarations differ: ./dist/index.d.ts != ./dist/index.d.cts',
    ]);

    await writeFile(
      resolve(packageRoot, 'dist/index.d.cts'),
      'export declare const value: string;\n',
    );
    await expect(checkDualDeclarationParity(entries, () => packageRoot)).resolves.toEqual([]);
  });
});
