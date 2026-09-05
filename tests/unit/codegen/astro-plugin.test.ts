import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { livePreviewCodegen, type AstroCodegenOptions } from '@/codegen/astro-plugin';

type Integration = ReturnType<typeof livePreviewCodegen>;
type SetupParams = Parameters<NonNullable<Integration['hooks']['astro:config:setup']>>[0];

interface Log {
  readonly info: string[];
  readonly warn: string[];
  readonly error: string[];
  readonly api: NonNullable<SetupParams['logger']>;
}

function makeLog(): Log {
  const info: string[] = [];
  const warn: string[] = [];
  const error: string[] = [];
  return {
    info,
    warn,
    error,
    api: {
      info: (message) => info.push(message),
      warn: (message) => warn.push(message),
      error: (message) => error.push(message),
    },
  };
}

const live: Integration[] = [];

/** Every integration is torn down through the build hook, which closes the watcher. */
afterEach(() => {
  for (const integration of live) void integration.hooks['astro:build:start']?.();
  live.length = 0;
});

const CONFIG = `
  import { collections } from './collections';
  export default { collections };
`;
const POSTS = `export const collections = [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }];`;
const POSTS_CHANGED = `export const collections = [{ slug: 'posts', fields: [{ name: 'subtitle', type: 'text' }] }];`;

/** An Astro project whose collections live in a directory beside the config, as they really do. */
async function astroProject(posts = POSTS): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pll-astro-'));
  await mkdir(join(root, 'collections'), { recursive: true });
  await writeFile(join(root, 'payload.config.ts'), CONFIG, 'utf8');
  await writeFile(
    join(root, 'collections/index.ts'),
    `export { collections } from './posts';`,
    'utf8',
  );
  await writeFile(join(root, 'collections/posts.ts'), posts, 'utf8');
  return root;
}

async function setup(
  options: AstroCodegenOptions,
  params: { readonly command: string; readonly root: URL | string; readonly logger?: Log },
): Promise<void> {
  const integration = livePreviewCodegen(options);
  live.push(integration);
  await integration.hooks['astro:config:setup']?.({
    command: params.command,
    ...(params.logger === undefined ? {} : { logger: params.logger.api }),
    config: { root: params.root },
  });
}

/** Waits for the debounced regeneration instead of assuming a fixed delay. */
async function until(check: () => boolean | Promise<boolean>, budgetMs = 6000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function settle(ms = 600): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('paths are relative to Astro root, not the working directory', () => {
  it('writes the types under the root Astro reports, given as a file URL', async () => {
    const root = await astroProject();
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'src/payload-types.ts', watch: false },
      { command: 'build', root: pathToFileURL(`${root}/`), logger: log },
    );
    expect(await readFile(join(root, 'src/payload-types.ts'), 'utf8')).toContain(
      'export interface Posts {',
    );
    expect(log.error).toEqual([]);
  }, 30_000);

  it('accepts a root given as a plain path', async () => {
    const root = await astroProject();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'types.ts', watch: false, quiet: true },
      { command: 'build', root },
    );
    expect(await readFile(join(root, 'types.ts'), 'utf8')).toContain('export interface Posts {');
  }, 30_000);
});

describe('the dev watcher covers the directory, not just the config file', () => {
  it('regenerates when a collection file next to the config changes', async () => {
    const root = await astroProject();
    const out = join(root, 'src/payload-types.ts');
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'src/payload-types.ts' },
      { command: 'dev', root, logger: log },
    );
    expect(log.info).toHaveLength(1);
    expect(await readFile(out, 'utf8')).not.toContain('subtitle');

    await writeFile(join(root, 'collections/posts.ts'), POSTS_CHANGED, 'utf8');
    // The file lands before the plugin logs it; waiting on the file alone
    // read the log a tick too early on Node 26.
    const regenerated = await until(() => log.info.length > 1);
    expect(regenerated).toBe(true);
    expect(await readFile(out, 'utf8')).toContain('subtitle');
  }, 30_000);

  it('ignores its own output and files it does not parse, so it never loops', async () => {
    const root = await astroProject();
    const out = join(root, 'payload-types.ts');
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'payload-types.ts' },
      {
        command: 'dev',
        root,
        logger: log,
      },
    );
    expect(log.info).toHaveLength(1);

    await writeFile(join(root, 'README.md'), '# notes\n', 'utf8');
    await writeFile(out, `${await readFile(out, 'utf8')}\n// touched\n`, 'utf8');
    await settle();
    expect(log.info).toHaveLength(1);
    expect(await readFile(out, 'utf8')).toContain('// touched');
  }, 30_000);

  it('does not watch outside `astro dev`', async () => {
    const root = await astroProject();
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'types.ts' },
      {
        command: 'build',
        root,
        logger: log,
      },
    );
    await writeFile(join(root, 'collections/posts.ts'), POSTS_CHANGED, 'utf8');
    await settle();
    expect(log.info).toHaveLength(1);
    expect(await readFile(join(root, 'types.ts'), 'utf8')).not.toContain('subtitle');
  }, 30_000);

  it('honours watch: false during dev', async () => {
    const root = await astroProject();
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'types.ts', watch: false },
      {
        command: 'dev',
        root,
        logger: log,
      },
    );
    await writeFile(join(root, 'collections/posts.ts'), POSTS_CHANGED, 'utf8');
    await settle();
    expect(log.info).toHaveLength(1);
  }, 30_000);
});

describe('a config that yields nothing', () => {
  it('logs an error and leaves the previous types in place', async () => {
    const root = await astroProject('export const collections = [];');
    const out = join(root, 'types.ts');
    await writeFile(out, '// still importing this\n', 'utf8');
    const log = makeLog();
    await setup(
      { configPath: 'payload.config.ts', outPath: 'types.ts', watch: false },
      {
        command: 'build',
        root,
        logger: log,
      },
    );
    expect(log.error.join('\n')).toContain('nothing written');
    expect(await readFile(out, 'utf8')).toBe('// still importing this\n');
  }, 30_000);
});
