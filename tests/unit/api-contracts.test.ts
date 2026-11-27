import { describe, expect, it } from 'vitest';

import {
  buildAttwInvocations,
  collectTypedApiEntries,
  findForgottenExportBaselineViolation,
} from '../../scripts/api-contracts';

describe('packed API contracts', () => {
  const manifest = {
    name: 'example-package',
    exports: {
      '.': {
        import: {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
        // What `require()` matches: the same ES module, the same declarations.
        default: {
          types: './dist/index.d.ts',
          default: './dist/index.js',
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
        requirable: true,
      },
      {
        exportName: './adapter',
        importTypesTarget: './dist/adapter.d.ts',
        reportName: 'example-package--adapter',
        requirable: false,
      },
    ]);
  });

  it('runs ATTW once, for ES modules, against the exact archive', () => {
    const tarball = '/tmp/exact/example-package-1.2.3.tgz';

    expect(buildAttwInvocations(tarball, collectTypedApiEntries(manifest))).toEqual([
      {
        args: [
          tarball,
          '--profile',
          'esm-only',
          '--no-definitely-typed',
          '--entrypoints',
          '.',
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

  it('refuses a manifest that names a CommonJS build, which 3.0 does not have', () => {
    expect(() =>
      collectTypedApiEntries({
        name: 'dual-package',
        exports: {
          '.': {
            import: { types: './dist/index.d.ts', default: './dist/index.js' },
            require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
          },
        },
      }),
    ).toThrow('. names a CommonJS build; the package is ESM alone since 3.0');
  });

  it('refuses an entry whose require() would get other declarations than its import', () => {
    expect(() =>
      collectTypedApiEntries({
        name: 'split-package',
        exports: {
          './adapter': {
            import: { types: './dist/adapter.d.ts', default: './dist/adapter.js' },
            default: { types: './dist/other.d.ts', default: './dist/adapter.js' },
          },
        },
      }),
    ).toThrow(
      './adapter gives require() other declarations than import: ./dist/other.d.ts != ./dist/adapter.d.ts',
    );
  });
});
