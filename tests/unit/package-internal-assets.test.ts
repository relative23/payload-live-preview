/**
 * An internal template has no public exports-map target to catch its absence.
 * Require it in both the archive and installed tree, while keeping the compiler
 * import literal and the optional framework out of peer-free consumers.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findPackedContentFailures,
  findPackedTargetFailures,
} from '../../scripts/package-smoke-manifest';

const ASSET = 'dist/adapters/astro/FragmentBridge.astro';
const publicFiles = ['LICENSE', 'README.md', 'package.json'];

describe('internal Astro bridge asset', () => {
  it('requires the non-exported template in the archive', async () => {
    expect(await findPackedContentFailures(new Set(publicFiles))).toContain(
      `missing required package file: ${ASSET}`,
    );
    expect(await findPackedContentFailures(new Set([...publicFiles, ASSET]))).toEqual([]);
  });

  it('checks the installed internal asset even though it has no public export', async () => {
    const consumer = await mkdtemp(join(tmpdir(), 'plp-internal-asset-unit-'));
    try {
      expect(await findPackedTargetFailures({ exports: {} }, consumer, new Set([ASSET]))).toContain(
        `internal.astroBridge target is absent after install: ./${ASSET}`,
      );
      await mkdir(join(consumer, 'dist/adapters/astro'), { recursive: true });
      await writeFile(join(consumer, ASSET), '<slot />');
      expect(await findPackedTargetFailures({ exports: {} }, consumer, new Set([ASSET]))).toEqual(
        [],
      );
      expect(await findPackedTargetFailures({ exports: {} }, consumer, new Set())).toContain(
        `internal.astroBridge target is absent from the tarball: ./${ASSET}`,
      );
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  });

  it('copies the asset during the existing build without creating a public entry', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      exports: Record<string, unknown>;
    };
    expect(manifest.scripts['build:assets']).toContain("'FragmentBridge'");
    expect(Object.keys(manifest.exports).some((name) => name.includes('FragmentBridge'))).toBe(
      false,
    );
    expect(readFileSync(resolve('tsup.config.ts'), 'utf8')).toContain("'./FragmentBridge.astro'");
  });
});
