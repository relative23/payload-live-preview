import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrate } from '@migrate/runner';

function memoryIo(files: Record<string, string>) {
  const written: Record<string, string> = {};
  return {
    written,
    io: {
      list: () => Promise.resolve(Object.keys(files)),
      read: (path: string) => Promise.resolve(files[path] ?? ''),
      write: (path: string, content: string) => {
        written[path] = content;
        return Promise.resolve();
      },
    },
  };
}

const FILES = {
  'src/mw.ts': "import { isPreviewRequest } from 'payload-live-preview';\nisPreviewRequest(r);\n",
  'src/other.ts': 'export const x = 1;\n',
  'src/own.ts': 'function isPreviewRequest() {}\nisPreviewRequest();\n',
};

describe('runMigrate with injected io', () => {
  it('reports the files it would change and writes nothing in dry-run', async () => {
    const { written, io } = memoryIo(FILES);
    const result = await runMigrate('src', { io });
    expect(result.changedCount).toBe(1);
    expect(result.files.find((f) => f.file === 'mw.ts')?.changed).toBe(true);
    expect(result.files.find((f) => f.file === 'own.ts')?.changed).toBe(false);
    expect(Object.keys(written)).toEqual([]);
  });

  it('writes the changed files with --write and leaves the rest', async () => {
    const { written, io } = memoryIo(FILES);
    const result = await runMigrate('src', { write: true, io });
    expect(Object.keys(written)).toEqual(['src/mw.ts']);
    expect(written['src/mw.ts']).toContain('hasPreviewIntent');
    expect(result.byCodemod['rename-is-preview-request']).toBe(1);
  });

  it('honours --only', async () => {
    const { io } = memoryIo({
      'a.ts':
        "import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';\nisPreviewRequest(r); fetchPreviewDocument(x);\n",
    });
    const result = await runMigrate('a.ts', { io, only: ['rename-is-preview-request'] });
    expect(Object.keys(result.byCodemod)).toEqual(['rename-is-preview-request']);
  });

  it('records line-level edits rather than whole files', async () => {
    const { io } = memoryIo(FILES);
    const result = await runMigrate('src', { io });
    const edits = result.files.find((f) => f.file === 'mw.ts')?.edits;
    expect(edits).toEqual([
      {
        codemod: 'rename-is-preview-request',
        count: 2,
        lines: [
          {
            line: 1,
            before: "import { isPreviewRequest } from 'payload-live-preview';",
            after: "import { hasPreviewIntent } from 'payload-live-preview';",
          },
          { line: 2, before: 'isPreviewRequest(r);', after: 'hasPreviewIntent(r);' },
        ],
      },
    ]);
  });
});

describe('runMigrate walking a real directory', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plp-migrate-runner-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('visits every source extension, skips declaration files and generated directories', async () => {
    const src = "import { isPreviewRequest } from 'payload-live-preview';\nisPreviewRequest(r);\n";
    await mkdir(join(dir, 'src', 'pages'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
    await mkdir(join(dir, '.svelte-kit'), { recursive: true });
    await writeFile(join(dir, 'src', 'middleware.ts'), src);
    await writeFile(join(dir, 'src', 'hooks.server.js'), src);
    await writeFile(join(dir, 'src', 'pages', 'index.astro'), `---\n${src}---\n<h1>x</h1>\n`);
    await writeFile(
      join(dir, 'src', 'env.d.ts'),
      `declare module 'payload-live-preview' { export function isPreviewRequest(r: Request): boolean; }\n`,
    );
    await writeFile(join(dir, 'src', 'types.d.mts'), src);
    await writeFile(join(dir, 'src', 'notes.md'), src);
    await writeFile(join(dir, 'node_modules', 'dep', 'index.ts'), src);
    await writeFile(join(dir, '.svelte-kit', 'gen.ts'), src);

    const result = await runMigrate(dir);
    expect(result.files.map((f) => f.file).sort()).toEqual([
      'src/hooks.server.js',
      'src/middleware.ts',
      'src/pages/index.astro',
    ]);
    expect(result.changedCount).toBe(3);
  });
});
