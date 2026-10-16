/**
 * The React recipe is a separate exact-lock consumer, not an Astro-only upgrade.
 * Unknown modes and versions fail before installation; runtime renderer absence
 * remains selectable as a native counterexample of the same application.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  astroResourceRenderer,
  astroResourceVersion,
} from '../../e2e/helpers/astro-resource-versions';

describe('Astro React resource selection', () => {
  it.each(['react-server', 'react-unconfigured'])(
    'isolates the %s consumer and artifacts',
    (renderer) => {
      expect(astroResourceRenderer('7.3.2', renderer)).toBe(renderer);
      expect(astroResourceVersion('7.3.2', renderer)).toEqual({
        version: '7.3.2',
        dependencyRoot: 'tests/fixtures/astro-react-deps',
        artifactRoot: 'test-results/hardening/h05-astro-react/native',
      });
    },
  );

  it.each(['4.9.0', '4.16.19', '5.18.2', '6.4.8'])(
    'does not infer React recipe support for %s',
    (version) => {
      expect(() => astroResourceRenderer(version, 'react-server')).toThrow(
        'Unreviewed Astro React version',
      );
      expect(() => astroResourceVersion(version, 'react-unconfigured')).toThrow(
        'Unreviewed Astro React version',
      );
    },
  );

  it('pins real React and its renderer without changing the Astro-only consumer', () => {
    const read = (root: string) =>
      JSON.parse(readFileSync(`tests/fixtures/${root}/package.json`, 'utf8')) as {
        private: boolean;
        dependencies: Record<string, string>;
      };
    const react = read('astro-react-deps');
    expect(react.private).toBe(true);
    expect(react.dependencies).toMatchObject({
      astro: '7.3.2',
      '@astrojs/react': '6.0.6',
      vite: '8.1.4',
      react: '19.2.8',
      'react-dom': '19.2.8',
    });
    expect(read('astro-resource-deps').dependencies['react']).toBeUndefined();
  });
});
