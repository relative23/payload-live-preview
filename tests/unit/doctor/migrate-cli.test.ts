import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@doctor/cli';

/**
 * The `pll migrate` command end to end (roadmap 1.9.0): it walks a real
 * directory, reports in dry-run, writes with `--write`, honours `--only`,
 * and fails usage errors cleanly.
 */

let dir: string;
let out: string;
let err: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plp-migrate-cli-'));
  out = '';
  err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const SRC = "import { isPreviewRequest } from 'payload-live-preview';\nisPreviewRequest(r);\n";

describe('pll migrate', () => {
  it('reports in dry-run without writing', async () => {
    await writeFile(join(dir, 'a.ts'), SRC, 'utf8');
    const code = await run(['migrate', dir]);
    expect(code).toBe(0);
    expect(out).toContain('would migrate a.ts');
    expect(out).toContain('Re-run with --write');
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toBe(SRC);
  });

  it('writes with --write', async () => {
    await writeFile(join(dir, 'a.ts'), SRC, 'utf8');
    const code = await run(['migrate', dir, '--write']);
    expect(code).toBe(0);
    expect(out).toContain('migrated a.ts');
    expect(await readFile(join(dir, 'a.ts'), 'utf8')).toContain('hasPreviewIntent');
  });

  it('honours --only', async () => {
    await writeFile(
      join(dir, 'a.ts'),
      "import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';\nisPreviewRequest(r); fetchPreviewDocument(x);\n",
      'utf8',
    );
    await run(['migrate', dir, '--write', '--only', 'rename-is-preview-request']);
    const result = await readFile(join(dir, 'a.ts'), 'utf8');
    expect(result).toContain('hasPreviewIntent');
    expect(result).toContain('fetchPreviewDocument'); // the move codemod was excluded
  });

  it('skips node_modules and dist while walking', async () => {
    await writeFile(join(dir, 'keep.ts'), SRC, 'utf8');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'dep.ts'), SRC, 'utf8');
    await run(['migrate', dir]);
    expect(out).toContain('would migrate keep.ts');
    expect(out).not.toContain('node_modules');
  });

  it('prints help and requires a path', async () => {
    expect(await run(['migrate', '--help'])).toBe(0);
    expect(out).toContain('pll migrate');
    out = '';
    expect(await run(['migrate'])).toBe(1);
    expect(err).toContain('a path is required');
  });

  it('rejects an unknown option', async () => {
    expect(await run(['migrate', dir, '--bogus'])).toBe(1);
    expect(err).toContain('unknown option --bogus');
  });
});
