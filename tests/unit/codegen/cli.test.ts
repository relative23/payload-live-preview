import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@/codegen/cli';

let workDir: string;

beforeEach(async () => {
  workDir = join(tmpdir(), `pll-cli-${Math.random().toString(36).slice(2)}`);
  await mkdir(workDir, { recursive: true });
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

  it('returns 2 when no globals or collections are found', async () => {
    const configPath = await writeConfig(`export default { globals: [], collections: [] };`);
    const outPath = join(workDir, 'empty.ts');
    const { stderrSpy, restore } = captureStdio();
    try {
      const code = await run(['--config', configPath, '--out', outPath]);
      expect(code).toBe(2);
      const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toContain('no globals or collections');
    } finally {
      restore();
    }
  });
});
