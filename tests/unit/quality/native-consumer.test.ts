/**
 * Every native consumer gets the reviewed archive through the same two steps. They are
 * framework-neutral, so they are held here against a toy lock rather than only through
 * the browser suites that happen to exercise them.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFixtureTemplates, deriveArchiveConsumer } from '../../e2e/helpers/native-consumer';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plp-native-consumer-unit-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function archive(manifest: Record<string, unknown>): Promise<string> {
  await mkdir(join(directory, 'pack/package'), { recursive: true });
  await writeFile(join(directory, 'pack/package/package.json'), JSON.stringify(manifest));
  const file = join(directory, 'payload-live-preview.tgz');
  const packed = spawnSync('tar', ['-czf', file, '-C', join(directory, 'pack'), 'package']);
  expect(packed.status).toBe(0);
  return file;
}

async function dependencies(
  workspace: boolean,
  direct: Record<string, string> = { astro: '4.0.0' },
): Promise<string> {
  const root = join(directory, 'deps');
  await mkdir(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      dependencies: { ...direct, ...(workspace ? { 'payload-live-preview': 'file:../..' } : {}) },
      devDependencies: { typescript: '^5' },
    }),
  );
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        '': {
          dependencies: {
            ...direct,
            ...(workspace ? { 'payload-live-preview': 'file:../..' } : {}),
          },
          devDependencies: { typescript: '^5' },
        },
        'node_modules/astro': { version: '4.0.0', resolved: 'https://registry.example/astro' },
        'node_modules/typescript': { version: '5.9.3' },
        ...(workspace
          ? { 'node_modules/payload-live-preview': { version: '0.0.1', resolved: 'file:../..' } }
          : {}),
      },
    }),
  );
  return root;
}

describe('deriveArchiveConsumer', () => {
  it('replaces the workspace record by the archive and pins every direct version', async () => {
    const tarball = await archive({
      name: 'payload-live-preview',
      version: '9.9.9',
      peerDependencies: { astro: '>=4.0.0 <8.0.0' },
      license: 'MIT',
    });
    const consumer = await deriveArchiveConsumer(await dependencies(true), tarball);
    const location = `file:${tarball}`;
    expect(consumer.manifest.dependencies).toEqual({
      astro: '4.0.0',
      'payload-live-preview': location,
    });
    expect(consumer.manifest.devDependencies).toEqual({ typescript: '5.9.3' });
    expect(consumer.lock.packages['']?.devDependencies).toEqual({ typescript: '5.9.3' });
    expect(consumer.lock.packages['']?.dependencies?.['payload-live-preview']).toBe(location);
    expect(consumer.lock.packages['node_modules/payload-live-preview']).toMatchObject({
      version: '9.9.9',
      resolved: location,
      integrity: `sha512-${createHash('sha512')
        .update(await readFile(tarball))
        .digest('base64')}`,
      peerDependencies: { astro: '>=4.0.0 <8.0.0' },
      license: 'MIT',
    });
    expect(consumer.packaged).toMatchObject({ name: 'payload-live-preview', version: '9.9.9' });
  });

  it('adds the archive to a lock that never knew the workspace package', async () => {
    const tarball = await archive({ name: 'payload-live-preview', version: '1.0.0' });
    const consumer = await deriveArchiveConsumer(await dependencies(false), tarball);
    expect(Object.keys(consumer.manifest.dependencies)).toEqual(['astro', 'payload-live-preview']);
    expect(consumer.lock.packages['node_modules/payload-live-preview']?.version).toBe('1.0.0');
  });

  it('refuses a direct dependency the lock does not hold', async () => {
    const tarball = await archive({ name: 'payload-live-preview', version: '1.0.0' });
    await expect(
      deriveArchiveConsumer(await dependencies(false, { astro: '4.0.0', vite: '5.4.21' }), tarball),
    ).rejects.toThrow('Missing pinned consumer dependency');
  });

  it('refuses an archive that is not this package', async () => {
    const tarball = await archive({ name: 'something-else', version: '1.0.0' });
    await expect(deriveArchiveConsumer(await dependencies(false), tarball)).rejects.toThrow();
  });
});

describe('copyFixtureTemplates', () => {
  it('drops the .fixture suffix at any depth and keeps other names', async () => {
    const source = join(directory, 'templates');
    await mkdir(join(source, 'src/pages'), { recursive: true });
    await writeFile(join(source, 'astro.config.mjs.fixture'), 'config');
    await writeFile(join(source, 'src/pages/index.astro.fixture'), 'page');
    await writeFile(join(source, 'plain.txt'), 'plain');
    const target = join(directory, 'app');
    await copyFixtureTemplates(source, target);
    expect((await readdir(target)).sort()).toEqual(['astro.config.mjs', 'plain.txt', 'src']);
    expect(await readFile(join(target, 'src/pages/index.astro'), 'utf8')).toBe('page');
  });
});
