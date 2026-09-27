/**
 * Each native resource run selects a reviewed exact dependency graph.
 * Reject arbitrary paths and unmeasured versions before creating consumers;
 * the default host and the latest resource fixture keep their existing locks.
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  astroResourceVersion,
  prepareAstroResourceVersion,
} from '../../e2e/helpers/astro-resource-versions';

describe('Astro resource version selection', () => {
  it('keeps the existing Astro 7 fixture as the default', () => {
    expect(astroResourceVersion()).toEqual({
      version: '7.3.2',
      dependencyRoot: 'tests/fixtures/astro-resource-deps',
      artifactRoot: 'test-results/hardening/h05-astro-resources',
    });
  });

  it.each(['4.9.0', '4.16.19', '5.18.2', '6.4.8'])(
    'pins %s and its strict native build',
    (version) => {
      const selected = astroResourceVersion(version);
      expect(selected.version).toBe(version);
      expect(selected.artifactRoot).toBe(`test-results/hardening/h05-astro-versions/${version}`);
      const manifest = JSON.parse(
        readFileSync(`${selected.dependencyRoot}/package.json`, 'utf8'),
      ) as {
        private: boolean;
        version: string;
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
        overrides?: unknown;
      };
      expect(manifest.private).toBe(true);
      expect(manifest.version).toBe('0.0.0');
      expect(manifest.dependencies['astro']).toBe(version);
      expect(manifest.scripts['build']).toBe('npm run typecheck && astro build');
      expect(manifest.scripts['typecheck']).toBe(
        'astro sync && astro-check --minimumFailingSeverity warning',
      );
      expect(manifest.overrides).toBeUndefined();
      const npmrc = readFileSync(`${selected.dependencyRoot}/.npmrc`, 'utf8');
      expect(npmrc).toContain('strict-allow-scripts=true');
      expect(npmrc).toContain('ignore-scripts=false');
      expect(npmrc).toContain('dangerously-allow-all-scripts=false');
      expect(npmrc).toContain('legacy-peer-deps=false');
    },
  );

  it.each(['', '4', '4.0.0', '^5', 'latest', '../astro-host-deps', '/tmp/consumer'])(
    'refuses unreviewed selection %j',
    (version) => {
      expect(() => astroResourceVersion(version)).toThrow('Unreviewed Astro resource version');
    },
  );

  it.each(['4.9.0', '4.16.19'])('uses the real ViewTransitions owner on %s', async (version) => {
    const directory = await mkdtemp(join(tmpdir(), 'plp-resource-version-unit-'));
    try {
      await mkdir(join(directory, 'src/pages/continuation/[editor]'), { recursive: true });
      const paths = ['src/pages/index.astro', 'src/pages/continuation/[editor]/[locale].astro'];
      for (const path of paths) {
        await writeFile(
          join(directory, path),
          'import { ClientRouter } from \'astro:transitions\';\n<ClientRouter fallback="swap" />',
        );
      }
      await prepareAstroResourceVersion(directory, version);
      for (const path of paths) {
        expect(await readFile(join(directory, path), 'utf8')).toBe(
          'import { ViewTransitions as ClientRouter } from \'astro:transitions\';\n<ClientRouter fallback="swap" />',
        );
      }
      await expect(prepareAstroResourceVersion(directory, version)).rejects.toThrow(
        'Missing native Astro router import',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('leaves modern router templates untouched', async () => {
    await expect(prepareAstroResourceVersion('/does-not-exist', '7.3.2')).resolves.toBeUndefined();
  });
});
