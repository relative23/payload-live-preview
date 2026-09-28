/**
 * ADR 0021's server half: the table links entry modules exactly as Astro's
 * production pipeline does, the integration writes it over the placeholder in
 * real server chunks, and the resolver fails closed without it.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { livePreview, resolveIslandModule } from '@adapters/astro/index';
import { createIslandModuleResolver } from '@adapters/astro/island-modules';
import {
  hasIslandTablePlaceholder,
  islandModuleTable,
  islandModuleUrl,
  writeIslandTable,
} from '@adapters/astro/island-table';

const PLACEHOLDER = '@@PAYLOAD_LIVE_PREVIEW_ISLAND_MODULES@@';
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('islandModuleUrl — Astro createAssetLink, without query parameters', () => {
  it.each([
    ['_astro/Card.abc.js', '/', undefined, '/_astro/Card.abc.js'],
    ['_astro/Card.abc.js', '/docs/', undefined, '/docs/_astro/Card.abc.js'],
    ['_astro/Card.abc.js', '/docs', undefined, '/docs/_astro/Card.abc.js'],
    ['_astro/a.js?v=1#x', '/', undefined, '/_astro/a.js?v=1#x'],
    [
      '_astro/Card.abc.js',
      '/',
      'https://cdn.example.com',
      'https://cdn.example.com/_astro/Card.abc.js',
    ],
    [
      '_astro/Card.abc.js',
      '/',
      { js: 'https://js.example.com/', fallback: 'https://cdn.example.com' },
      'https://js.example.com/_astro/Card.abc.js',
    ],
    [
      '_astro/Card.abc.mjs',
      '/',
      { js: 'https://js.example.com', fallback: 'https://cdn.example.com' },
      'https://cdn.example.com/_astro/Card.abc.mjs',
    ],
    ['_astro/Card.abc.js', undefined, undefined, '_astro/Card.abc.js'],
    ['_astro/Card.abc.js', '/', { css: 'https://css.example.com' }, '_astro/Card.abc.js'],
    ['', '/', 'https://cdn.example.com', ''],
    ['data:text/javascript,0', '/', undefined, 'data:text/javascript,0'],
  ] as const)('%s with base %s and prefix %j links to %s', (href, base, prefix, expected) => {
    expect(islandModuleUrl(href, base, prefix)).toBe(expected);
  });

  it('builds the table from every entry module, or none without them', () => {
    expect(
      islandModuleTable({
        base: '/',
        entryModules: {
          '/app/src/components/Panel.tsx': '_astro/Panel.x1.js',
          '@astrojs/react/client.js': '_astro/client.y2.js',
          'astro:scripts/before-hydration.js': '',
        },
      }),
    ).toEqual({
      '/app/src/components/Panel.tsx': '/_astro/Panel.x1.js',
      '@astrojs/react/client.js': '/_astro/client.y2.js',
      'astro:scripts/before-hydration.js': '',
    });
    expect(islandModuleTable({ base: '/' })).toBeUndefined();
  });
});

describe('writeIslandTable', () => {
  it('replaces every quoted placeholder with the table and nothing else', () => {
    const code = [
      `const a = resolver("${PLACEHOLDER}");`,
      `const b = resolver('${PLACEHOLDER}');`,
      `const c = resolver(\`${PLACEHOLDER}\`);`,
      `const d = "prefix ${PLACEHOLDER} suffix";`,
    ].join('\n');
    const table = { '/app/Panel.tsx': '/_astro/Panel.js' };

    expect(hasIslandTablePlaceholder(code)).toBe(true);
    const written = writeIslandTable(code, table).split('\n');

    const json = JSON.stringify(JSON.stringify(table));
    expect(written.slice(0, 3)).toEqual([
      `const a = resolver(${json});`,
      `const b = resolver(${json});`,
      `const c = resolver(${json});`,
    ]);
    expect(written[3]).toContain(PLACEHOLDER);
    expect(hasIslandTablePlaceholder('no placeholder here')).toBe(false);
  });
});

describe('resolveIslandModule', () => {
  it('fails closed in an unbuilt module, naming the integration', async () => {
    await expect(resolveIslandModule('/app/src/components/Panel.tsx')).rejects.toThrow(
      /livePreview\(\).*astro build/su,
    );
  });

  it('resolves only specifiers the build emitted, keeping an empty before-hydration entry', async () => {
    const resolve = createIslandModuleResolver({
      '/app/src/components/Panel.tsx': '/_astro/Panel.js',
      'astro:scripts/before-hydration.js': '',
    });

    await expect(resolve('/app/src/components/Panel.tsx')).resolves.toBe('/_astro/Panel.js');
    await expect(resolve('astro:scripts/before-hydration.js')).resolves.toBe('');
    await expect(resolve('/app/src/components/Other.tsx')).rejects.toThrow(
      /no client module for island specifier "\/app\/src\/components\/Other\.tsx"/u,
    );
  });

  it.each([null, [], { panel: 1 }, 'text'])('refuses a malformed table %j', async (table) => {
    await expect(createIslandModuleResolver(table)('panel')).rejects.toThrow(/livePreview\(\)/u);
  });
});

describe('livePreview() writes the table into the server build', () => {
  async function serverBuild(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'plp-island-table-'));
    created.push(dir);
    await mkdir(join(dir, 'chunks'), { recursive: true });
    await writeFile(join(dir, 'entry.mjs'), 'export const unrelated = 1;\n');
    await writeFile(
      join(dir, 'chunks', 'fragment.mjs'),
      `export const resolve = createIslandModuleResolver(readTable("${PLACEHOLDER}"));\n`,
    );
    await writeFile(join(dir, 'chunks', 'notes.txt'), `"${PLACEHOLDER}"`);
    return dir;
  }

  it('fills every server chunk carrying the placeholder once the client build is known', async () => {
    const dir = await serverBuild();
    const integration = livePreview();
    const info = vi.fn();

    integration.hooks['astro:config:done']({
      config: { build: { server: pathToFileURL(`${dir}/`) } },
    });
    integration.hooks['astro:build:ssr']({
      manifest: { base: '/', entryModules: { '/app/Panel.tsx': '_astro/Panel.x1.js' } },
    });
    await integration.hooks['astro:build:done']({ logger: { info } });

    expect(await readFile(join(dir, 'chunks', 'fragment.mjs'), 'utf8')).toBe(
      'export const resolve = createIslandModuleResolver(readTable("{\\"/app/Panel.tsx\\":\\"/_astro/Panel.x1.js\\"}"));\n',
    );
    expect(await readFile(join(dir, 'entry.mjs'), 'utf8')).toBe('export const unrelated = 1;\n');
    expect(await readFile(join(dir, 'chunks', 'notes.txt'), 'utf8')).toBe(`"${PLACEHOLDER}"`);
    expect(info).toHaveBeenCalledWith('island module table written into 1 server chunk(s)');
  });

  it('leaves the build alone without an SSR manifest or a server directory', async () => {
    const dir = await serverBuild();
    const staticBuild = livePreview();
    staticBuild.hooks['astro:config:done']({
      config: { build: { server: pathToFileURL(`${dir}/`) } },
    });
    await staticBuild.hooks['astro:build:done']({});

    const noServer = livePreview();
    noServer.hooks['astro:config:done']({ config: {} });
    noServer.hooks['astro:build:ssr']({ manifest: { entryModules: {} } });
    await noServer.hooks['astro:build:done']({});

    expect(await readFile(join(dir, 'chunks', 'fragment.mjs'), 'utf8')).toContain(PLACEHOLDER);
  });
});
