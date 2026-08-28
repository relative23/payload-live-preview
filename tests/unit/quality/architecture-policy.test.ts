import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readArchitectureModules,
  type ArchitectureModule,
} from '../../../scripts/architecture-graph';
import { findArchitectureViolations } from '../../../scripts/architecture-rules';

const dependency = (target: string) => ({ specifier: target, target, kind: 'runtime' as const });

describe('architecture policy', () => {
  it('rejects a runtime cycle while allowing erased type-only edges', () => {
    const modules: readonly ArchitectureModule[] = [
      { path: 'src/core/a.ts', dependencies: [dependency('src/core/b.ts')] },
      { path: 'src/core/b.ts', dependencies: [dependency('src/core/a.ts')] },
      {
        path: 'src/core/type-user.ts',
        dependencies: [{ specifier: './a', target: 'src/core/a.ts', kind: 'type' }],
      },
    ];

    expect(findArchitectureViolations(modules).map(({ kind }) => kind)).toEqual(['runtime-cycle']);
  });

  it('rejects upward layer imports, browser-to-server imports and Node builtins', () => {
    const modules: readonly ArchitectureModule[] = [
      { path: 'src/core/runtime.ts', dependencies: [dependency('src/adapters/astro/index.ts')] },
      { path: 'src/client/index.ts', dependencies: [dependency('src/codegen/index.ts')] },
      {
        path: 'src/security/csp.ts',
        dependencies: [{ specifier: 'node:fs', kind: 'runtime' }],
      },
      { path: 'src/adapters/astro/index.ts', dependencies: [] },
      { path: 'src/codegen/index.ts', dependencies: [] },
    ];

    const kinds = findArchitectureViolations(modules).map(({ kind }) => kind);
    expect(kinds).toHaveLength(4);
    expect(kinds).toEqual(
      expect.arrayContaining(['browser-node-builtin', 'layer-boundary', 'server-boundary']),
    );
  });

  it('rejects static dynamic-import, require and import-equals boundary bypasses', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'plp-architecture-policy-'));
    try {
      await mkdir(join(repository, 'src/security'), { recursive: true });
      await writeFile(
        join(repository, 'src/security/dynamic-bypass.ts'),
        [
          'import crypto = require("node:crypto");',
          'const fsModule = import(`node:fs`);',
          'const pathModule = require("node:path");',
          'export { crypto, fsModule, pathModule };',
        ].join('\n'),
      );
      const modules = await readArchitectureModules(repository);

      expect(findArchitectureViolations(modules).map(({ dependency }) => dependency)).toEqual([
        'node:crypto',
        'node:fs',
        'node:path',
      ]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('resolves Node-style JavaScript specifiers to their TypeScript source files', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'plp-architecture-policy-'));
    try {
      await mkdir(join(repository, 'src/core'), { recursive: true });
      await mkdir(join(repository, 'src/security'), { recursive: true });
      await writeFile(join(repository, 'src/core/runtime.ts'), 'export const runtime = true;\n');
      await writeFile(
        join(repository, 'src/core/runtime.generated.ts'),
        'export const generated = true;\n',
      );
      await writeFile(join(repository, 'src/core/module.mts'), 'export const module = true;\n');
      await writeFile(join(repository, 'src/core/common.cts'), 'export const common = true;\n');
      await writeFile(
        join(repository, 'src/security/bypass.ts'),
        [
          "import '../core/runtime.js';",
          "import '../core/runtime.generated';",
          "import '../core/module.mjs';",
          "import '../core/common.cjs';",
        ].join('\n'),
      );

      const modules = await readArchitectureModules(repository);
      const bypass = modules.find(({ path }) => path === 'src/security/bypass.ts');

      expect(bypass?.dependencies.map(({ target }) => target)).toEqual([
        'src/core/runtime.ts',
        'src/core/runtime.generated.ts',
        'src/core/module.mts',
        'src/core/common.cts',
      ]);
      expect(findArchitectureViolations(modules).map(({ kind }) => kind)).toEqual([
        'layer-boundary',
        'layer-boundary',
        'layer-boundary',
        'layer-boundary',
      ]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('fails closed for unresolved relative source imports while allowing reviewed assets', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'plp-architecture-policy-'));
    try {
      await mkdir(join(repository, 'src/security'), { recursive: true });
      await writeFile(join(repository, 'package.json'), '{}\n');
      await writeFile(
        join(repository, 'src/security/bypass.ts'),
        [
          "import './missing.js';",
          "import metadata from '../../package.json' with { type: 'json' };",
          'export { metadata };',
        ].join('\n'),
      );

      const violations = findArchitectureViolations(await readArchitectureModules(repository));

      expect(violations).toEqual([
        expect.objectContaining({
          kind: 'unresolved-internal',
          module: 'src/security/bypass.ts',
          dependency: './missing.js',
        }),
      ]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('keeps the complete repository graph within the executable boundaries', async () => {
    const modules = await readArchitectureModules(process.cwd());
    expect(findArchitectureViolations(modules)).toEqual([]);
    expect(modules.length).toBeGreaterThan(0);
  });
});
