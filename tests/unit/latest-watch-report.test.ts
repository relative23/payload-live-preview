import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { issueBody, issueTitle, readResults } from '../../scripts/report-latest-watch';
import { WORKFLOW_EXPECTATIONS } from '../../scripts/workflow-expectations';

/**
 * The latest watch is a scheduled run nobody watches, and each integration that fails gets an
 * issue of its own. These hold what the report job reads from the watch jobs' artifacts and
 * what the issue says, and that the right to write it sits on the job that installs nothing.
 */

const folders: string[] = [];
function artifacts(entries: Record<string, { result: unknown; ls?: unknown }>): string {
  const root = mkdtempSync(join(tmpdir(), 'plp-latest-watch-'));
  folders.push(root);
  for (const [name, { result, ls }] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'result.json'), JSON.stringify(result));
    if (ls !== undefined) {
      writeFileSync(
        join(root, name, 'npm-ls.json'),
        typeof ls === 'string' ? ls : JSON.stringify(ls),
      );
    }
  }
  return root;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('what the report job reads', () => {
  it('reads one result per artifact folder, with the versions npm resolved', () => {
    const root = artifacts({
      'latest-watch-nuxt': {
        result: { integration: 'nuxt', outcome: 'failure' },
        ls: { dependencies: { nuxt: { version: '4.7.0' }, vue: { version: '3.6.0' }, broken: {} } },
      },
      'latest-watch-hooks': { result: { integration: 'hooks', outcome: 'success' } },
    });

    expect(readResults(root)).toEqual([
      { integration: 'hooks', outcome: 'success', versions: {} },
      { integration: 'nuxt', outcome: 'failure', versions: { nuxt: '4.7.0', vue: '3.6.0' } },
    ]);
  });

  it('names no version when npm wrote nothing it can read', () => {
    const root = artifacts({
      'latest-watch-next': { result: { integration: 'next', outcome: 'failure' }, ls: '' },
    });

    expect(readResults(root)).toEqual([{ integration: 'next', outcome: 'failure', versions: {} }]);
  });
});

describe('the issue', () => {
  it('names the integration, how the job ended, the run and what was installed', () => {
    const body = issueBody(
      { integration: 'sveltekit', outcome: 'failure', versions: { '@sveltejs/kit': '3.2.0' } },
      'https://github.com/owner/repo/actions/runs/1',
    );

    expect(issueTitle('sveltekit')).toBe(
      'Latest watch: the latest sveltekit release fails against this package',
    );
    expect(body).toContain('`sveltekit`');
    expect(body).toContain('`failure`');
    expect(body).toContain('https://github.com/owner/repo/actions/runs/1');
    expect(body).toContain('| `@sveltejs/kit` | 3.2.0 |');
    expect(body).toContain('`latest-watch-sveltekit`');
  });

  it('says so when the install did not get far enough to list anything', () => {
    expect(issueBody({ integration: 'astro', outcome: 'failure', versions: {} }, 'run')).toContain(
      'The install did not get far enough to list what it resolved.',
    );
  });
});

describe('the workflow that files it', () => {
  it('writes issues only from the report job, which installs nothing', () => {
    const watch = WORKFLOW_EXPECTATIONS['latest-watch.yml'];

    expect(watch?.permissions).toEqual({ contents: 'read' });
    expect(watch?.jobs['report']?.permissions).toEqual({ contents: 'read', issues: 'write' });
    const reportRuns = (watch?.jobs['report']?.steps ?? []).flatMap((step) =>
      'run' in step ? [step.run] : [],
    );
    expect(reportRuns).toEqual(['node scripts/report-latest-watch.ts latest-watch']);
    for (const name of ['hooks', 'frameworks'] as const) {
      const job = watch?.jobs[name];
      expect(job?.permissions, name).toBeUndefined();
      const installs = (job?.steps ?? []).flatMap((step) =>
        'run' in step && /\binstall --no-/u.test(step.run) ? [step.run] : [],
      );
      expect(installs.length, name).toBeGreaterThan(0);
      for (const install of installs) expect(install, name).toContain('--ignore-scripts');
    }
  });
});
