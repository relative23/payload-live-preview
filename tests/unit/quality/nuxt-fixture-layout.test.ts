/**
 * The Nuxt 4 fixture is the Nuxt 3 fixture in Nuxt 4's `app/` layout, so the
 * browser suite proves both majors with one set of pages. A page, route or
 * component added to one and not the other would split what each job tests;
 * only the files the layout forces apart may differ.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const NUXT3 = resolve(ROOT, 'examples/nuxt-payload');
const NUXT4 = resolve(ROOT, 'examples/nuxt4-payload');
/** What Nuxt 4 reads from `app/`; `server/`, `public/` and the fixture's `lib/` stay at the root. */
const APP_ENTRIES = new Set(['app.vue', 'components', 'pages', 'plugins']);
const GENERATED = new Set(['node_modules', '.nuxt', '.output', 'package-lock.json']);
/** The manifest, the configs and the three files whose relative imports cross the new `app/` level. */
const LAYOUT_DIFFERENCES = [
  'app/components/Hero.vue',
  'app/pages/hybrid.vue',
  'nuxt.config.ts',
  'package.json',
  'server/routes/payload/fragment.post.ts',
  'tsconfig.json',
];

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function sourceFiles(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (GENERATED.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path, root) : [relative(root, path)];
  });
}

function inNuxt4Layout(path: string): string {
  return APP_ENTRIES.has(path.split('/')[0] ?? '') ? `app/${path}` : path;
}

describe('Nuxt 4 fixture layout', () => {
  it('has every file of the Nuxt 3 fixture, the app files under app/', () => {
    expect(sourceFiles(NUXT4).sort()).toEqual(sourceFiles(NUXT3).map(inNuxt4Layout).sort());
  });

  it('keeps every file byte for byte except those the layout forces apart', () => {
    const differing = sourceFiles(NUXT3).filter(
      (path) =>
        readFileSync(resolve(NUXT3, path), 'utf8') !==
        readFileSync(resolve(NUXT4, inNuxt4Layout(path)), 'utf8'),
    );
    expect(differing.map(inNuxt4Layout).sort()).toEqual(LAYOUT_DIFFERENCES);
  });

  it('hashes fragment scope ids from app/ and imports components from there', () => {
    expect(read('examples/nuxt-payload/nuxt.config.ts')).toContain(
      "srcDir: fileURLToPath(new URL('./', import.meta.url))",
    );
    expect(read('examples/nuxt4-payload/nuxt.config.ts')).toContain(
      "srcDir: fileURLToPath(new URL('./app/', import.meta.url))",
    );
    const fragmentRoute = read('examples/nuxt4-payload/server/routes/payload/fragment.post.ts');
    expect(fragmentRoute).toContain("import Hero from '../../../app/components/Hero.vue';");
    expect(fragmentRoute).toContain("import Notice from '../../../app/components/Notice.vue';");
  });

  it('installs Nuxt 4 and type-checks through the four projects Nuxt generates', () => {
    const manifest = JSON.parse(read('examples/nuxt4-payload/package.json')) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const tsconfig = JSON.parse(read('examples/nuxt4-payload/tsconfig.json')) as {
      references?: { path: string }[];
    };

    expect(manifest.devDependencies?.['nuxt']).toMatch(/^\^4\./u);
    expect(manifest.scripts?.['dev']).toBe('nuxt dev --port 4176');
    expect(tsconfig.references?.map(({ path }) => path)).toEqual([
      './.nuxt/tsconfig.app.json',
      './.nuxt/tsconfig.server.json',
      './.nuxt/tsconfig.shared.json',
      './.nuxt/tsconfig.node.json',
    ]);
  });

  it('serves the browser tests on port 4176 only when the run selects it', () => {
    const playwright = read('playwright.config.ts');

    expect(playwright).toContain("process.env['PLP_NUXT_FIXTURE'] ?? 'nuxt-payload'");
    expect(playwright).toContain("nuxtFixture !== 'nuxt4-payload'");
    expect(playwright).toContain('command: `npm --prefix examples/${nuxtFixture} run dev`');
  });
});
