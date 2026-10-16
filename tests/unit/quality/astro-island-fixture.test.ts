/**
 * Island characterization must not change the established React SSR consumer.
 * Only the exact reviewed Astro/React lock may select the isolated new overlay.
 */
import { describe, expect, it } from 'vitest';
import {
  astroResourceRenderer,
  astroResourceVersion,
} from '../../e2e/helpers/astro-resource-versions';

describe('native Astro island characterization', () => {
  it('isolates the island artifacts while reusing the unchanged exact React lock', () => {
    expect(astroResourceVersion('7.3.2', 'react-islands')).toEqual({
      version: '7.3.2',
      dependencyRoot: 'tests/fixtures/astro-react-deps',
      artifactRoot: 'test-results/hardening/h05-astro-islands/native',
    });
    expect(astroResourceRenderer('7.3.2', 'react-islands')).toBe('react-islands');
  });
  it.each(['4.9.0', '4.16.19', '5.18.2', '6.4.8'])(
    'refuses unreviewed island mode on %s',
    (version) => {
      expect(() => astroResourceVersion(version, 'react-islands')).toThrow(
        'Unreviewed Astro React version',
      );
      expect(() => astroResourceRenderer(version, 'react-islands')).toThrow(
        'Unreviewed Astro React version',
      );
    },
  );
});
