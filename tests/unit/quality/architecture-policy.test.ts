/**
 * Executable imports must obey the same boundaries regardless of source syntax.
 * Small isolated repositories prove the scanner before checking the real graph.
 */
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
  it('tracks compiled Astro frontmatter and template expressions as executable dependencies', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'plp-architecture-policy-'));
    try {
      await mkdir(join(repository, 'src/runtime/security'), { recursive: true });
      await writeFile(
        join(repository, 'src/runtime/security/entry.ts'),
        "export const load = () => import('./Bridge.astro');",
      );
      await writeFile(
        join(repository, 'src/runtime/security/Bridge.astro'),
        [
          '---',
          "import type { AstroInstance } from 'astro';",
          'const Component = Astro.props.component;',
          '---',
          '<Component>{import("node:fs")}{fetch("/")}</Component>',
        ].join('\n'),
      );
      const modules = await readArchitectureModules(repository);
      expect(modules.find((row) => row.path.endsWith('entry.ts'))?.dependencies[0]?.target).toBe(
        'src/runtime/security/Bridge.astro',
      );
      const bridge = modules.find((row) => row.path.endsWith('Bridge.astro'));
      expect(bridge?.dependencies).toEqual([
        { specifier: 'astro', kind: 'type' },
        { specifier: 'node:fs', kind: 'runtime' },
      ]);
      expect(bridge?.capabilities.map((row) => row.kind)).toEqual(['network']);
      expect(findArchitectureViolations(modules).map((row) => row.kind)).toEqual([
        'browser-node-builtin',
      ]);
      await writeFile(
        join(repository, 'src/runtime/security/Bridge.astro'),
        '---\nconst = broken\n---\n<div />',
      );
      await expect(readArchitectureModules(repository)).rejects.toThrow(
        'Cannot statically inspect Astro template',
      );
      await writeFile(
        join(repository, 'src/runtime/security/Bridge.astro'),
        '---\nconst title = "test";\n---\n<script>fetch("/")</script>',
      );
      await expect(readArchitectureModules(repository)).rejects.toThrow(
        'Cannot statically inspect Astro template',
      );
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it('rejects a runtime cycle while allowing erased type-only edges', () => {
    const modules: readonly ArchitectureModule[] = [
      {
        path: 'src/runtime/core/a.ts',
        dependencies: [dependency('src/runtime/core/b.ts')],
        capabilities: [],
      },
      {
        path: 'src/runtime/core/b.ts',
        dependencies: [dependency('src/runtime/core/a.ts')],
        capabilities: [],
      },
      {
        path: 'src/runtime/core/type-user.ts',
        dependencies: [{ specifier: './a', target: 'src/runtime/core/a.ts', kind: 'type' }],
        capabilities: [],
      },
    ];

    expect(findArchitectureViolations(modules).map(({ kind }) => kind)).toEqual(['runtime-cycle']);
  });

  it('reads the server-only group off the zone, with no list of domains', () => {
    const modules: readonly ArchitectureModule[] = [
      {
        path: 'src/tools/report/index.ts',
        dependencies: [{ specifier: 'node:fs', kind: 'runtime' }],
        capabilities: [],
      },
      {
        path: 'src/server/keys/index.ts',
        dependencies: [{ specifier: 'node:crypto', kind: 'runtime' }],
        capabilities: [],
      },
      {
        path: 'src/index.ts',
        dependencies: [
          dependency('src/tools/report/index.ts'),
          dependency('src/server/keys/index.ts'),
        ],
        capabilities: [],
      },
    ];

    expect(
      findArchitectureViolations(modules).map(({ kind, dependency: to }) => `${kind} ${to}`),
    ).toEqual([
      'server-boundary src/server/keys/index.ts',
      'server-boundary src/tools/report/index.ts',
    ]);
  });

  it('refuses an import out of the runtime zone for a domain no list names', () => {
    const modules: readonly ArchitectureModule[] = [
      {
        path: 'src/runtime/outline/index.ts',
        dependencies: [dependency('src/adapters/astro/index.ts')],
        capabilities: [],
      },
      { path: 'src/adapters/astro/index.ts', dependencies: [], capabilities: [] },
    ];

    expect(
      findArchitectureViolations(modules).map(({ kind, message }) => `${kind}: ${message}`),
    ).toEqual([
      'layer-boundary: src/runtime/outline/index.ts crosses the outline -> adapters runtime boundary',
    ]);
  });

  it('rejects upward layer imports, browser-to-server imports and Node builtins', () => {
    const modules: readonly ArchitectureModule[] = [
      {
        path: 'src/runtime/core/runtime.ts',
        dependencies: [dependency('src/adapters/astro/index.ts')],
        capabilities: [],
      },
      {
        path: 'src/runtime/client/index.ts',
        dependencies: [dependency('src/tools/codegen/index.ts')],
        capabilities: [],
      },
      {
        path: 'src/runtime/security/csp.ts',
        dependencies: [{ specifier: 'node:fs', kind: 'runtime' }],
        capabilities: [],
      },
      { path: 'src/adapters/astro/index.ts', dependencies: [], capabilities: [] },
      { path: 'src/tools/codegen/index.ts', dependencies: [], capabilities: [] },
    ];

    const kinds = findArchitectureViolations(modules).map(({ kind }) => kind);
    expect(kinds).toHaveLength(4);
    expect(kinds).toEqual(
      expect.arrayContaining(['browser-node-builtin', 'layer-boundary', 'server-boundary']),
    );
  });

  it('lets a named build-time module use Node, and keeps browser code away from it', () => {
    // The Nuxt module runs in Nuxt's build, not in a page. Naming it says both
    // halves at once: it may reach for Node, and nothing that ships to a
    // browser may reach for it.
    const modules: readonly ArchitectureModule[] = [
      {
        path: 'src/adapters/nuxt/module.ts',
        dependencies: [{ specifier: 'node:path', kind: 'runtime' }],
        capabilities: [],
      },
      {
        path: 'src/adapters/nuxt/adapter.ts',
        dependencies: [dependency('src/adapters/nuxt/module.ts')],
        capabilities: [],
      },
    ];

    expect(findArchitectureViolations(modules)).toEqual([
      {
        kind: 'server-boundary',
        module: 'src/adapters/nuxt/adapter.ts',
        dependency: 'src/adapters/nuxt/module.ts',
        message: 'src/adapters/nuxt/adapter.ts imports server-only src/adapters/nuxt/module.ts',
      },
    ]);
  });

  it('rejects static dynamic-import, require and import-equals boundary bypasses', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'plp-architecture-policy-'));
    try {
      await mkdir(join(repository, 'src/runtime/security'), { recursive: true });
      await writeFile(
        join(repository, 'src/runtime/security/dynamic-bypass.ts'),
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
      await mkdir(join(repository, 'src/runtime/core'), { recursive: true });
      await mkdir(join(repository, 'src/runtime/security'), { recursive: true });
      await writeFile(
        join(repository, 'src/runtime/core/runtime.ts'),
        'export const runtime = true;\n',
      );
      await writeFile(
        join(repository, 'src/runtime/core/runtime.generated.ts'),
        'export const generated = true;\n',
      );
      await writeFile(
        join(repository, 'src/runtime/core/module.mts'),
        'export const module = true;\n',
      );
      await writeFile(
        join(repository, 'src/runtime/core/common.cts'),
        'export const common = true;\n',
      );
      await writeFile(
        join(repository, 'src/runtime/security/bypass.ts'),
        [
          "import '../core/runtime.js';",
          "import '../core/runtime.generated';",
          "import '../core/module.mjs';",
          "import '../core/common.cjs';",
        ].join('\n'),
      );

      const modules = await readArchitectureModules(repository);
      const bypass = modules.find(({ path }) => path === 'src/runtime/security/bypass.ts');

      expect(bypass?.dependencies.map(({ target }) => target)).toEqual([
        'src/runtime/core/runtime.ts',
        'src/runtime/core/runtime.generated.ts',
        'src/runtime/core/module.mts',
        'src/runtime/core/common.cts',
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
      await mkdir(join(repository, 'src/runtime/security'), { recursive: true });
      await writeFile(join(repository, 'package.json'), '{}\n');
      await writeFile(
        join(repository, 'src/runtime/security/bypass.ts'),
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
          module: 'src/runtime/security/bypass.ts',
          dependency: './missing.js',
        }),
      ]);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  // A scan of the whole repository: 1.4 s alone, 3 to 4 s under coverage, and
  // past the default 5 s on a shared machine (load average 87).
  it('keeps the complete repository graph within the executable boundaries', async () => {
    const modules = await readArchitectureModules(process.cwd());
    expect(findArchitectureViolations(modules)).toEqual([]);
    expect(modules.length).toBeGreaterThan(0);
  }, 60_000);
});
