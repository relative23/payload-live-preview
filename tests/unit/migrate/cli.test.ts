import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '@doctor/cli';

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

const MIDDLEWARE = [
  "import { defineMiddleware } from 'astro:middleware';",
  "import { isPreviewRequest, createPreviewBindings } from 'payload-live-preview';",
  'export const onRequest = defineMiddleware((context, next) => {',
  '  context.locals.preview = isPreviewRequest(context.request);',
  '  context.locals.bindings = createPreviewBindings({ authorized: context.locals.preview });',
  '  return next();',
  '});',
  '',
].join('\n');

const HOOKS = [
  "import { fetchPreviewDocument } from 'payload-live-preview';",
  'export async function load({ params }) {',
  "  return { page: await fetchPreviewDocument({ serverURL: env.CMS, collection: 'pages', where: { slug: { equals: params.slug } } }) };",
  '}',
  '',
].join('\n');

/** A consumer's own wrapper module: the rename cannot be applied here. */
const GUARD = [
  "import { isPreviewRequest } from 'payload-live-preview';",
  "export function hasPreviewIntent(r) { return isPreviewRequest(r, { signals: ['query'] }); }",
  '',
].join('\n');

async function project(files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), content, 'utf8');
  }
}

describe('pll migrate', () => {
  it('dry-runs a clean project with exit 0, naming what each codemod would change', async () => {
    const page = `---\nimport { isPreviewRequest } from 'payload-live-preview';\nconst preview = isPreviewRequest(Astro.request);\n---\n<h1>{preview}</h1>\n`;
    await project({ 'src/middleware.ts': MIDDLEWARE, 'src/pages/index.astro': page });
    const code = await run(['migrate', dir]);
    expect(code).toBe(0);
    expect(out).toContain(
      'would migrate src/middleware.ts (rename-is-preview-request: 2 line(s), rename-bindings-authorized-option: 1 line(s))',
    );
    expect(out).toContain(
      'would migrate src/pages/index.astro (rename-is-preview-request: 2 line(s))',
    );
    expect(out).toContain('Would migrate 2 file(s). Re-run with --write to apply.');
    expect(out).not.toContain('manual attention');
    expect(await readFile(join(dir, 'src', 'middleware.ts'), 'utf8')).toBe(MIDDLEWARE);
  });

  it('writes with --write and reports migrated files', async () => {
    await project({ 'src/middleware.ts': MIDDLEWARE });
    expect(await run(['migrate', dir, '--write'])).toBe(0);
    expect(out).toContain('migrated src/middleware.ts');
    expect(out).toContain('Migrated 1 file(s).');
    const migrated = await readFile(join(dir, 'src', 'middleware.ts'), 'utf8');
    expect(migrated).toContain('hasPreviewIntent(context.request)');
    expect(migrated).toContain('authorization: context.locals.preview');
  });

  it('exits 3 and lists file:line when a file needs a human, still applying what is safe', async () => {
    await project({
      'src/middleware.ts': MIDDLEWARE,
      'src/lib/guard.ts': GUARD,
      'src/routes/+page.server.ts': HOOKS,
    });
    const code = await run(['migrate', dir, '--write']);
    expect(code).toBe(3);
    expect(out).toContain('2 file(s) need manual attention:');
    expect(out).toContain('  src/lib/guard.ts:2: this module already binds hasPreviewIntent');
    expect(out).toContain(
      '  src/routes/+page.server.ts:3: fetchPreviewDocument() was rewritten onto definePreview().fetchDocument()',
    );
    expect(await readFile(join(dir, 'src', 'lib', 'guard.ts'), 'utf8')).toBe(GUARD);
    expect(await readFile(join(dir, 'src', 'middleware.ts'), 'utf8')).toContain('hasPreviewIntent');
    expect(await readFile(join(dir, 'src', 'routes', '+page.server.ts'), 'utf8')).toContain(
      "import { definePreview } from 'payload-live-preview/server';",
    );
  });

  it('honours --only in both spellings', async () => {
    await project({ 'a.ts': MIDDLEWARE, 'b.ts': MIDDLEWARE });
    await run(['migrate', join(dir, 'a.ts'), '--write', '--only', 'rename-is-preview-request']);
    const a = await readFile(join(dir, 'a.ts'), 'utf8');
    expect(a).toContain('hasPreviewIntent');
    expect(a).toContain('authorized:');
    await run([
      'migrate',
      join(dir, 'b.ts'),
      '--write',
      '--only=rename-bindings-authorized-option',
    ]);
    const b = await readFile(join(dir, 'b.ts'), 'utf8');
    expect(b).toContain('isPreviewRequest');
    expect(b).toContain('authorization:');
  });

  it('skips node_modules and dist while walking', async () => {
    await project({
      'keep.ts': MIDDLEWARE,
      'node_modules/dep/index.ts': MIDDLEWARE,
      'dist/out.js': MIDDLEWARE,
    });
    await run(['migrate', dir]);
    expect(out).toContain('would migrate keep.ts');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('dist/');
  });

  it('prints help, requires a path, rejects an unknown option and an unreadable path', async () => {
    expect(await run(['migrate', '--help'])).toBe(0);
    expect(out).toContain('pll migrate');
    expect(out).toContain('3  at least one file needs manual attention');
    expect(await run(['migrate'])).toBe(1);
    expect(err).toContain('a path is required');
    expect(await run(['migrate', dir, '--bogus'])).toBe(1);
    expect(err).toContain('unknown option --bogus');
    expect(await run(['migrate', join(dir, 'missing')])).toBe(1);
    expect(err).toContain('ENOENT');
  });
});
