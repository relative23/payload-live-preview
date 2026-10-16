import { describe, expect, it } from 'vitest';
import {
  synchronizeFeatureEvidenceVersions,
  synchronizeFeatureEvidenceVersionSource,
} from '../../../scripts/sync-lockfile-metadata';

/** The version hook owns root-package evidence values and no framework version or formatting around them. */

const matrix = {
  untouched: { nested: true },
  featureEvidence: [
    {
      id: 'inline-runtime',
      version: {
        kind: 'exact',
        value: '2.0.5',
        package: 'payload-live-preview',
        source: { kind: 'root-package' },
      },
    },
    {
      id: 'package-smoke',
      version: {
        kind: 'exact',
        value: '2.0.5',
        package: 'payload-live-preview',
        source: { kind: 'root-package' },
      },
    },
    {
      id: 'astro-current',
      version: {
        kind: 'exact',
        value: '7.3.2',
        package: 'astro',
        source: { kind: 'lockfile', fixture: 'examples/astro-payload' },
      },
    },
    {
      id: 'astro-floor',
      version: {
        kind: 'floor',
        value: '4.0.0',
        package: 'astro',
        source: { kind: 'peer-floor' },
      },
    },
  ],
};

describe('compatibility-evidence version synchronization', () => {
  it('updates all and only root-package cells without mutating the input', () => {
    const original = structuredClone(matrix);

    const synchronized = synchronizeFeatureEvidenceVersions(matrix, '2.1.0');

    expect(matrix).toEqual(original);
    expect(synchronized).toEqual({
      ...original,
      featureEvidence: [
        {
          ...original.featureEvidence[0],
          version: { ...original.featureEvidence[0]!.version, value: '2.1.0' },
        },
        {
          ...original.featureEvidence[1],
          version: { ...original.featureEvidence[1]!.version, value: '2.1.0' },
        },
        original.featureEvidence[2],
        original.featureEvidence[3],
      ],
    });
    expect(synchronizeFeatureEvidenceVersions(synchronized, '2.1.0')).toEqual(synchronized);
  });

  it('changes only the owned JSON string tokens and preserves every surrounding byte', () => {
    const source = `${JSON.stringify(matrix, undefined, 2)}\n`;
    const synchronized = synchronizeFeatureEvidenceVersionSource(source, '2.1.0');
    const restored = synchronizeFeatureEvidenceVersionSource(synchronized, '2.0.5');

    expect(restored).toBe(source);
    expect(synchronizeFeatureEvidenceVersionSource(synchronized, '2.1.0')).toBe(synchronized);
  });
});
