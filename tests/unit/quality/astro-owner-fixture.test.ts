/**
 * The page-owned recipe has its own artifacts and the exact reviewed React lock.
 * Selecting it must not relabel the raw native-fragment counterexample.
 */
import { describe, expect, it } from 'vitest';
import {
  astroResourceRenderer,
  astroResourceVersion,
} from '../../e2e/helpers/astro-resource-versions';

describe('native Astro page-owned React fixture', () => {
  it('isolates the page-owned renderer using the unchanged exact React lock', () => {
    expect(astroResourceVersion('7.3.2', 'react-owned')).toEqual({
      version: '7.3.2',
      dependencyRoot: 'tests/fixtures/astro-react-deps',
      artifactRoot: 'test-results/hardening/h05-astro-owner/native',
    });
    expect(astroResourceRenderer('7.3.2', 'react-owned')).toBe('react-owned');
  });
  it.each(['4.9.0', '4.16.19', '5.18.2', '6.4.8'])(
    'refuses unreviewed page-owned mode on %s',
    (version) => {
      expect(() => astroResourceVersion(version, 'react-owned')).toThrow(
        'Unreviewed Astro React version',
      );
      expect(() => astroResourceRenderer(version, 'react-owned')).toThrow(
        'Unreviewed Astro React version',
      );
    },
  );
});
