import { describe, expect, it } from 'vitest';
import {
  awaitRegistryPropagation,
  exactPublishArguments,
  isRegistryPropagationDelay,
  type PropagationClock,
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

describe('registry propagation', () => {
  function fakeClock(): PropagationClock & { readonly slept: number[] } {
    const slept: number[] = [];
    let current = 0;
    return {
      slept,
      now: () => current,
      sleep: async (ms) => {
        slept.push(ms);
        current += ms;
        await Promise.resolve();
      },
    };
  }

  const policy = { timeoutMs: 30_000, intervalMs: 5_000 } as const;

  it('costs nothing when the registry is already consistent', async () => {
    const clock = fakeClock();
    const outcome = await awaitRegistryPropagation(
      () => 'ready',
      () => true,
      policy,
      clock,
    );

    expect(outcome).toMatchObject({ ready: true, value: 'ready', attempts: 1, waitedMs: 0 });
    expect(clock.slept).toEqual([]);
  });

  it('keeps reading until the version becomes observable', async () => {
    const clock = fakeClock();
    const states = [{ kind: 'missing' }, { kind: 'missing' }, { kind: 'published' }] as const;
    let index = 0;

    const outcome = await awaitRegistryPropagation(
      () => states[Math.min(index++, states.length - 1)],
      (state) => state?.kind === 'published',
      policy,
      clock,
    );

    expect(outcome.ready).toBe(true);
    expect(outcome.attempts).toBe(3);
    expect(clock.slept).toEqual([5_000, 5_000]);
  });

  it('gives up inside the budget instead of sleeping past it', async () => {
    const clock = fakeClock();
    const outcome = await awaitRegistryPropagation(
      () => ({ kind: 'missing' }),
      (state) => state.kind === 'published',
      policy,
      clock,
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.value).toEqual({ kind: 'missing' });
    // Six sleeps land exactly on the budget; a seventh would overshoot it.
    expect(clock.slept).toHaveLength(6);
    expect(outcome.attempts).toBe(7);
    expect(outcome.waitedMs).toBe(policy.timeoutMs);
  });

  it('reports the last value so the caller owns the failure message', async () => {
    const clock = fakeClock();
    const outcome = await awaitRegistryPropagation(
      () => ({ status: 1, reason: 'ETARGET' }),
      (result) => result.status === 0,
      { timeoutMs: 10_000, intervalMs: 5_000 },
      clock,
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.value.reason).toBe('ETARGET');
    expect(outcome.attempts).toBeGreaterThan(1);
  });
});

describe('registry propagation delays', () => {
  it('recognises the shapes npm uses while a publish is still propagating', () => {
    expect(isRegistryPropagationDelay('npm error code ETARGET')).toBe(true);
    expect(isRegistryPropagationDelay('npm error notarget No matching version found')).toBe(true);
    expect(isRegistryPropagationDelay('npm ERR! code E404')).toBe(true);
    expect(isRegistryPropagationDelay('No matching version found for pkg@1.2.0')).toBe(true);
  });

  it('treats every other failure as real, so retrying cannot mask a fault', () => {
    expect(isRegistryPropagationDelay('npm error code E403 Forbidden')).toBe(false);
    expect(isRegistryPropagationDelay('npm error code ENEEDAUTH')).toBe(false);
    expect(isRegistryPropagationDelay('integrity checksum failed')).toBe(false);
    expect(isRegistryPropagationDelay('')).toBe(false);
  });
});
