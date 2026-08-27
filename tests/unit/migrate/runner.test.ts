import { describe, expect, it } from 'vitest';
import { runMigrate } from '@migrate/runner';

/**
 * The migrate walker (roadmap 1.9.0): it reports in dry-run, writes only with
 * `--write`, and touches only files the codemods change. The filesystem is
 * injected so this stays a unit test.
 */

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

describe('runMigrate', () => {
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
});
