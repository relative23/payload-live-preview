import { describe, expect, it } from 'vitest';
import {
  exactPublishArguments,
  publishCertifiedArtifact,
  registryArtifactAction,
  releaseTagForVersion,
} from '../../scripts/publish-artifact';

describe('exact artifact publisher', () => {
  it('publishes only an absent version and reconciles only an identical registry artifact', () => {
    expect(registryArtifactAction({ kind: 'missing' }, 'sha512-expected')).toBe('publish');
    expect(
      registryArtifactAction(
        { kind: 'published', integrity: 'sha512-expected' },
        'sha512-expected',
      ),
    ).toBe('reconcile');
    expect(() =>
      registryArtifactAction({ kind: 'published', integrity: 'sha512-other' }, 'sha512-expected'),
    ).toThrow(/different archive/u);
  });

  it('proves registry bytes before exposing tag/release state on publish and rerun', async () => {
    const published: string[] = [];
    const publishOutcome = await publishCertifiedArtifact('sha512-expected', {
      readRegistryState: () => {
        published.push('state');
        return { kind: 'missing' };
      },
      publishExactArchive: () => {
        published.push('publish');
      },
      verifyRegistryArchive: () => {
        published.push('verify');
      },
      ensureReleaseTag: () => {
        published.push('tag');
      },
    });
    expect(publishOutcome).toBe('published');
    expect(published).toEqual(['state', 'publish', 'verify', 'tag']);

    const reconciled: string[] = [];
    const reconcileOutcome = await publishCertifiedArtifact('sha512-expected', {
      readRegistryState: () => ({ kind: 'published', integrity: 'sha512-expected' }),
      publishExactArchive: () => {
        reconciled.push('publish');
      },
      verifyRegistryArchive: () => {
        reconciled.push('verify');
      },
      ensureReleaseTag: () => {
        reconciled.push('tag');
      },
    });
    expect(reconcileOutcome).toBe('reconciled');
    expect(reconciled).toEqual(['verify', 'tag']);
  });

  it('never creates release state when registry proof fails', async () => {
    const events: string[] = [];
    await expect(
      publishCertifiedArtifact('sha512-expected', {
        readRegistryState: () => ({ kind: 'published', integrity: 'sha512-expected' }),
        publishExactArchive: () => {
          events.push('publish');
        },
        verifyRegistryArchive: () => {
          events.push('verify');
          throw new Error('registry mismatch');
        },
        ensureReleaseTag: () => {
          events.push('tag');
        },
      }),
    ).rejects.toThrow('registry mismatch');
    expect(events).toEqual(['verify']);
  });

  it('passes the verified tgz directly to npm with lifecycle scripts disabled and provenance on', () => {
    const tarball = '/tmp/release/payload-live-preview-1.0.4.tgz';
    expect(exactPublishArguments(tarball)).toEqual([
      'publish',
      tarball,
      '--ignore-scripts',
      '--provenance',
      '--access',
      'public',
      '--tag',
      'latest',
      '--registry',
      'https://registry.npmjs.org',
      '--json',
    ]);
  });

  it('keeps stable Changesets tag naming and fails closed for prereleases', () => {
    expect(releaseTagForVersion('1.0.4')).toBe('v1.0.4');
    expect(() => releaseTagForVersion('2.0.0-beta.1')).toThrow(/prerelease/u);
    expect(() => releaseTagForVersion('latest')).toThrow(/version/u);
  });
});
