/**
 * Native resource contracts use exact, independently locked Astro consumers.
 * Keep the current fixture as the default and reject unknown selections before
 * an environment variable can choose dependency or artifact paths.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function astroResourceVersion(
  version = '7.3.2',
  renderer?: string,
): {
  version: string;
  dependencyRoot: string;
  artifactRoot: string;
} {
  if (
    renderer === 'react-server' ||
    renderer === 'react-unconfigured' ||
    renderer === 'react-islands' ||
    renderer === 'react-owned'
  ) {
    if (version !== '7.3.2') throw new Error('Unreviewed Astro React version: ' + version);
    return {
      version,
      dependencyRoot: 'tests/fixtures/astro-react-deps',
      artifactRoot:
        renderer === 'react-owned'
          ? 'test-results/hardening/h05-astro-owner/native'
          : renderer === 'react-islands'
            ? 'test-results/hardening/h05-astro-islands/native'
            : 'test-results/hardening/h05-astro-react/native',
    };
  }
  if (version === '7.3.2') {
    return {
      version,
      dependencyRoot: 'tests/fixtures/astro-resource-deps',
      artifactRoot: 'test-results/hardening/h05-astro-resources',
    };
  }
  if (!['4.9.0', '4.16.19', '5.18.2', '6.4.8'].includes(version)) {
    throw new Error('Unreviewed Astro resource version: ' + version);
  }
  return {
    version,
    dependencyRoot: `tests/fixtures/astro-resource-versions/${version}`,
    artifactRoot: `test-results/hardening/h05-astro-versions/${version}`,
  };
}

export async function prepareAstroResourceVersion(app: string, version: string): Promise<void> {
  if (!version.startsWith('4.')) return;
  // Astro 4 has the same native navigation owner under its original export name.
  for (const path of ['src/pages/index.astro', 'src/pages/continuation/[editor]/[locale].astro']) {
    const target = join(app, path);
    const source = await readFile(target, 'utf8');
    const before = "import { ClientRouter } from 'astro:transitions';";
    assert.ok(source.includes(before), 'Missing native Astro router import');
    await writeFile(
      target,
      source.replace(
        before,
        "import { ViewTransitions as ClientRouter } from 'astro:transitions';",
      ),
    );
  }
}

export function astroResourceRenderer(
  version: string,
  requested?: string,
):
  | 'package-default'
  | 'verified-context'
  | 'locals-catalog'
  | 'react-server'
  | 'react-unconfigured'
  | 'react-islands'
  | 'react-owned' {
  astroResourceVersion(version);
  if (
    requested === 'react-server' ||
    requested === 'react-unconfigured' ||
    requested === 'react-islands' ||
    requested === 'react-owned'
  ) {
    astroResourceVersion(version, requested);
    return requested;
  }
  if (requested === undefined) return version === '4.9.0' ? 'package-default' : 'verified-context';
  if (requested === 'locals-catalog' || requested === 'package-default') return requested;
  throw new Error('Unreviewed Astro resource renderer: ' + requested);
}
