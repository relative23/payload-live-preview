import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@doctor/cli';

const RENDER = [
  "import { lexicalToHtml } from 'payload-live-preview/lexical';",
  'export const html = lexicalToHtml(content);',
  '',
].join('\n');

let root: string;
let out: string;
let err: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plp-doctor-v3-'));
  await mkdir(join(root, 'src'));
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
  await rm(root, { recursive: true, force: true });
});

describe('pll doctor --v3 on the command line', () => {
  it('lists the place with its file and line and exits 3', async () => {
    await writeFile(join(root, 'src', 'render.ts'), RENDER);

    await expect(run(['doctor', '--v3', root])).resolves.toBe(3);
    expect(out).toContain('Row 18: `lexicalToHtml()` without a document');
    expect(out).toContain(`  ${join('src', 'render.ts')}:2\n`);
    expect(err).toBe('');
  });

  it('exits 0 when no call it could read changes', async () => {
    await writeFile(
      join(root, 'src', 'render.ts'),
      RENDER.replace('(content)', '(content, { document })'),
    );

    await expect(run(['doctor', `--v3=${root}`])).resolves.toBe(0);
    expect(out).toContain('No call in 1 file(s) that use the package changes with 3.0.');
  });

  it('prints the report as JSON with --json', async () => {
    await writeFile(join(root, 'src', 'render.ts'), RENDER);

    await expect(run(['doctor', '--v3', root, '--json'])).resolves.toBe(3);
    const report = JSON.parse(out) as {
      files: number;
      rows: { rule: { id: string; row: number }; places: { file: string; line: number }[] }[];
      unread: unknown[];
    };
    expect(report.files).toBe(1);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.rule).toMatchObject({ id: 'lexical-document', row: 18 });
    expect(report.rows[0]?.places).toEqual([
      { file: join('src', 'render.ts'), line: 2, call: 'lexicalToHtml' },
    ]);
    expect(report.unread).toEqual([]);
  });

  it.each([[['doctor', '--v3']], [['doctor', '--v3', '--json']], [['doctor', '--v3=']]])(
    'refuses %j: the flag takes the path',
    async (argv) => {
      await expect(run(argv)).resolves.toBe(1);
      expect(err).toBe('pll doctor: --v3 takes the path to read, such as --v3 ./src\n');
      expect(out).toBe('');
    },
  );

  it('refuses a URL beside --v3, because the two checks read different things', async () => {
    await expect(run(['doctor', 'https://example.com/', '--v3', root])).resolves.toBe(1);
    expect(err).toBe(
      'pll doctor: --v3 reads source and probes no URL; run the two checks one after the other\n',
    );
  });

  it('says which path it could not read and exits 1', async () => {
    const missing = join(root, 'nowhere');

    await expect(run(['doctor', '--v3', missing])).resolves.toBe(1);
    expect(err).toContain(`pll doctor: could not read ${missing}: `);
    expect(out).toBe('');
  });

  it('names the flag, its exit code and an example in the help', async () => {
    await expect(run(['doctor', '--help'])).resolves.toBe(0);
    expect(out).toContain('  pll doctor --v3 <path> [--json]\n');
    expect(out).toContain('  3  with --v3, at least one call that 3.0 changes\n');
    expect(out).toContain('  pll doctor --v3 ./src\n');
  });
});
