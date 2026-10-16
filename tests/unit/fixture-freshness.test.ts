/**
 * The local fixture gate must compare the complete package payload, not one
 * entry file. These synthetic packages keep the regression independent of a
 * preceding repository build or fixture install.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureFreshness } from '../../scripts/check-fixture-freshness';

async function writePackage(root: string, adapterSource: string): Promise<void> {
  await mkdir(join(root, 'dist', 'adapters', 'astro'), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      `${JSON.stringify({ files: ['dist', 'README.md', 'LICENSE'] }, undefined, 2)}\n`,
      'utf8',
    ),
    writeFile(join(root, 'README.md'), 'fixture package\n', 'utf8'),
    writeFile(join(root, 'LICENSE'), 'fixture license\n', 'utf8'),
    writeFile(join(root, 'dist', 'index.js'), 'export const root = true;\n', 'utf8'),
    writeFile(join(root, 'dist', 'adapters', 'astro', 'index.js'), adapterSource, 'utf8'),
  ]);
}

describe('fixture package freshness', () => {
  it('rejects an adapter-only stale copy when the root entry still matches', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'plp-fixture-freshness-'));
    const expected = join(temporaryRoot, 'expected');
    const fixture = join(temporaryRoot, 'fixture');
    try {
      await writePackage(expected, 'export const adapter = "current";\n');
      await writePackage(fixture, 'export const adapter = "stale";\n');

      expect(fixtureFreshness(expected, [{ name: 'astro', copy: fixture }])).toEqual([
        { name: 'astro', state: 'stale' },
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('accepts an exact copy but rejects an unexpected packaged file', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'plp-fixture-freshness-'));
    const expected = join(temporaryRoot, 'expected');
    const fixture = join(temporaryRoot, 'fixture');
    try {
      await writePackage(expected, 'export const adapter = "current";\n');
      await writePackage(fixture, 'export const adapter = "current";\n');
      expect(fixtureFreshness(expected, [{ name: 'astro', copy: fixture }])).toEqual([
        { name: 'astro', state: 'current' },
      ]);

      await writeFile(join(fixture, 'dist', 'retired.js'), 'stale artifact\n', 'utf8');
      expect(fixtureFreshness(expected, [{ name: 'astro', copy: fixture }])).toEqual([
        { name: 'astro', state: 'stale' },
      ]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
