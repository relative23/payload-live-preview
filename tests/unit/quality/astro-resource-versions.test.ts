/**
 * Each native resource run selects a reviewed exact dependency graph.
 * Reject arbitrary paths and unmeasured versions before creating consumers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { astroResourceVersion } from '../../e2e/helpers/astro-resource-versions';

describe('Astro resource version selection', () => {
  it('selects the one reviewed Astro fixture by default', () => {
    expect(astroResourceVersion()).toEqual({
      version: '7.4.5',
      dependencyRoot: 'tests/fixtures/astro-resource-deps',
      artifactRoot: 'test-results/hardening/h05-astro-resources',
    });
  });

  it('names the version its fixture pins', () => {
    const selected = astroResourceVersion();
    const manifest = JSON.parse(
      readFileSync(`${selected.dependencyRoot}/package.json`, 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['astro']).toBe(selected.version);
  });

  it.each([
    '',
    '4',
    '4.0.0',
    '4.9.0',
    '4.16.19',
    '5.18.2',
    '6.4.8',
    '^7',
    'latest',
    '../astro-host-deps',
    '/tmp/consumer',
  ])('refuses unreviewed selection %j', (version) => {
    expect(() => astroResourceVersion(version)).toThrow('Unreviewed Astro resource version');
  });
});
