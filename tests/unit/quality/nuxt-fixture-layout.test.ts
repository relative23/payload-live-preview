/**
 * The Nuxt example is in Nuxt 4's `app/` layout: what the framework reads from `app/` is
 * there, and `server/`, `public/` and the fixture's `lib/` stay at the root. The fragment
 * route and the scope ids depend on that split, so a file that drifts to the other side is
 * caught here and not in a browser run.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const NUXT = resolve(ROOT, 'examples/nuxt-payload');
const GENERATED = new Set(['node_modules', '.nuxt', '.output', 'package-lock.json']);

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function entries(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => !GENERATED.has(name) && !name.startsWith('.'))
    .sort();
}

describe('Nuxt fixture layout', () => {
  it('keeps the application under app/ and the server beside it', () => {
    expect(entries(NUXT)).toEqual([
      'app',
      'lib',
      'nuxt.config.ts',
      'package.json',
      'public',
      'server',
      'tsconfig.json',
    ]);
    expect(entries(resolve(NUXT, 'app'))).toEqual(['app.vue', 'components', 'pages']);
  });

  it('hashes fragment scope ids from app/ and imports components from there', () => {
    expect(read('examples/nuxt-payload/nuxt.config.ts')).toContain(
      "srcDir: fileURLToPath(new URL('./app/', import.meta.url))",
    );
    const fragmentRoute = read('examples/nuxt-payload/server/routes/payload/fragment.post.ts');
    expect(fragmentRoute).toContain("import Hero from '../../../app/components/Hero.vue';");
    expect(fragmentRoute).toContain("import Notice from '../../../app/components/Notice.vue';");
  });

  it('installs Nuxt 4 and type-checks through the four projects Nuxt generates', () => {
    const manifest = JSON.parse(read('examples/nuxt-payload/package.json')) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const tsconfig = JSON.parse(read('examples/nuxt-payload/tsconfig.json')) as {
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

  it('serves the browser tests on port 4176', () => {
    expect(read('playwright.config.ts')).toContain(
      "command: 'npm --prefix examples/nuxt-payload run dev',",
    );
  });
});
