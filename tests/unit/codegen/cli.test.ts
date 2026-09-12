import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@/codegen/cli';
import { Project } from 'ts-morph';
import { dirname, relative, resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';

let workDir: string;

beforeEach(async () => {
  // `mkdtemp` creates the directory atomically with a name nobody can predict.
  // Composing one from `Math.random()` and creating it afterwards leaves a
  // window in which another process can occupy the path.
  workDir = await mkdtemp(join(tmpdir(), 'pll-cli-'));
});

afterEach(async () => {
  // We don't clean up — tmpdir entries are short-lived enough.
});

async function writeConfig(source: string): Promise<string> {
  const path = join(workDir, 'payload.config.ts');
  await writeFile(path, source, 'utf8');
  return path;
}

function captureStdio(): {
  stdoutSpy: ReturnType<typeof vi.fn>;
  stderrSpy: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const stdoutSpy = vi.fn();
  const stderrSpy = vi.fn();
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: unknown): boolean => {
    stdoutSpy(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: unknown): boolean => {
    stderrSpy(String(chunk));
    return true;
  };
  return {
    stdoutSpy,
    stderrSpy,
    restore: () => {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    },
  };
}

describe('pll-codegen CLI', () => {
  it('writes the generated file and returns 0', async () => {
    const configPath = await writeConfig(`
      export default {
        globals: [{ slug: 'homepage', fields: [{ name: 'heroTitle', type: 'text' }] }],
        collections: [],
      };
    `);
    const outPath = join(workDir, 'payload-types.ts');
    const { stdoutSpy, restore } = captureStdio();
    try {
      const code = await run(['--config', configPath, '--out', outPath]);
      expect(code).toBe(0);
      const written = await readFile(outPath, 'utf8');
      expect(written).toContain('export interface Homepage');
      expect(written).toContain('heroTitle?: string;');
      // CLI logs the summary on stdout.
      const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stdout).toContain('1 globals');
      expect(stdout).toContain('0 collections');
    } finally {
      restore();
    }
  });

  it('writes the preview inventory when asked, and not otherwise', async () => {
    const configPath = await writeConfig(`
      export default {
        globals: [{
          slug: 'homepage',
          fields: [
            { name: 'heroTitle', type: 'text', localized: true },
            { type: 'row', fields: [{ name: 'tagline', type: 'text' }] },
          ],
        }],
        collections: [],
      };
    `);
    const outPath = join(workDir, 'types.ts');
    const inventoryPath = join(workDir, 'inventory.json');
    const { stdoutSpy, restore } = captureStdio();
    try {
      expect(await run(['--config', configPath, '--out', outPath])).toBe(0);
      await expect(readFile(inventoryPath, 'utf8')).rejects.toThrow();

      expect(
        await run(['--config', configPath, '--out', outPath, '--inventory', inventoryPath]),
      ).toBe(0);
      const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
        globals: { slug: string; fields: { path: string; localized: boolean }[] }[];
      };
      expect(inventory.globals[0]?.fields.map((field) => field.path)).toEqual([
        'heroTitle',
        // The `row` contributes no segment, matching what the runtime resolves.
        'tagline',
      ]);
      expect(inventory.globals[0]?.fields[0]?.localized).toBe(true);

      const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stdout).toContain('2 addressable fields');
    } finally {
      restore();
    }
  });

  it('supports --config=value syntax', async () => {
    const configPath = await writeConfig(`
      export default {
        globals: [{ slug: 'footer', fields: [] }],
        collections: [],
      };
    `);
    const outPath = join(workDir, 'out.ts');
    const { restore } = captureStdio();
    try {
      const code = await run([`--config=${configPath}`, `--out=${outPath}`, '--quiet']);
      expect(code).toBe(0);
      expect(await readFile(outPath, 'utf8')).toContain('Footer');
    } finally {
      restore();
    }
  });

  it('prints help and returns 0 with --help', async () => {
    const { stdoutSpy, restore } = captureStdio();
    try {
      const code = await run(['--help']);
      expect(code).toBe(0);
      const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stdout).toContain('pll-codegen');
      expect(stdout).toContain('--config');
    } finally {
      restore();
    }
  });

  it('returns 1 when --config or --out is missing', async () => {
    const { stderrSpy, restore } = captureStdio();
    try {
      const code = await run([]);
      expect(code).toBe(1);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toContain('--config and --out are required');
    } finally {
      restore();
    }
  });

  it('returns 2 when no globals or collections are found, leaving the types file as it was', async () => {
    const configPath = await writeConfig(`export default { globals: [], collections: [] };`);
    const outPath = join(workDir, 'empty.ts');
    await writeFile(outPath, '// the types someone is still importing\n', 'utf8');
    const { stderrSpy, restore } = captureStdio();
    try {
      const code = await run(['--config', configPath, '--out', outPath]);
      expect(code).toBe(2);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toContain('no globals or collections');
    } finally {
      restore();
    }
    expect(await readFile(outPath, 'utf8')).toBe('// the types someone is still importing\n');
  });

  it('does not replace the types with an empty file when --config is mistyped', async () => {
    await writeConfig(`
      export default {
        collections: [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }],
      };
    `);
    const outPath = join(workDir, 'payload-types.ts');
    const inventoryPath = join(workDir, 'inventory.json');
    await writeFile(outPath, 'export interface Posts { title?: string }\n', 'utf8');
    const { stderrSpy, restore } = captureStdio();
    try {
      const code = await run([
        '--config',
        join(workDir, 'paylod.config.ts'),
        '--out',
        outPath,
        '--inventory',
        inventoryPath,
      ]);
      expect(code).toBe(2);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toContain('Could not open');
      expect(stderr).toContain('Nothing written');
    } finally {
      restore();
    }
    expect(await readFile(outPath, 'utf8')).toBe('export interface Posts { title?: string }\n');
    await expect(readFile(inventoryPath, 'utf8')).rejects.toThrow();
  });
});

/**
 * `ts-morph` is an optional peer, so the entry behind the `pll-codegen` binary
 * has to be loadable without it: `--help` and a usage error are answers a
 * consumer gets before installing anything. Only static imports are followed
 * here, because only they are resolved at load time — that is the difference
 * between a sentence and `ERR_MODULE_NOT_FOUND` with ten stack frames, which is
 * what the published 2.0.0-rc.1 answered. `pll migrate` loads the peer on first
 * use for the same reason (src/migrate/ast.ts).
 */
describe('the CLI entry without the optional peer', () => {
  it('does not reach ts-morph through a static import', () => {
    const project = new Project({ skipLoadingLibFiles: true, skipFileDependencyResolution: true });
    const seen = new Set<string>();
    const reached: string[] = [];

    const sourcePath = (from: string, specifier: string): string | undefined => {
      if (!specifier.startsWith('.')) return undefined;
      const base = resolvePath(dirname(from), specifier).replace(/\.js$/u, '');
      return [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(candidate));
    };

    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = project.addSourceFileAtPath(file);
      const loadTime = [
        ...source.getImportDeclarations().filter((declaration) => !declaration.isTypeOnly()),
        ...source.getExportDeclarations().filter((declaration) => !declaration.isTypeOnly()),
      ];
      for (const declaration of loadTime) {
        const specifier = declaration.getModuleSpecifierValue();
        if (specifier === undefined) continue;
        if (specifier === 'ts-morph') reached.push(relative(process.cwd(), file));
        const next = sourcePath(file, specifier);
        if (next !== undefined) walk(next);
      }
    };
    walk(resolvePath(process.cwd(), 'src/codegen/cli.ts'));

    expect(reached).toEqual([]);
  });
});
