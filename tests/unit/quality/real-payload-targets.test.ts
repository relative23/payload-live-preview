/**
 * `playwright.real-payload.config.ts` starts the example named by `PLP_REAL_PAYLOAD_TARGET`; CI runs a
 * target only if the `real-payload-surfaces` matrix lists it, and installs the example the job's
 * `EXAMPLE` map names for it. A target the config knows and the matrix lacks is a test that never runs
 * on a push, and a map entry that names another directory installs the wrong dependencies, so the
 * three lists are compared here instead of by eye. The default Astro target and `hybrid` have jobs of
 * their own and are not in the config's tables.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matrixValues, parseWorkflow } from '../../../scripts/workflow-contracts';

const ROOT = resolve(import.meta.dirname, '../../..');
const JOB = 'real-payload-surfaces';

/** Every target the config's surface tables start, with the example directory it starts it in. */
function configuredExamples(): Record<string, string> {
  const config = readFileSync(resolve(ROOT, 'playwright.real-payload.config.ts'), 'utf8');
  const found: Record<string, string> = {};
  for (const entry of config.matchAll(
    /^ {2}(?:'([\w-]+)'|([\w-]+)): \{[^}]*?directory: '([\w-]+)'/gmu,
  )) {
    found[entry[1] ?? entry[2] ?? ''] = entry[3] ?? '';
  }
  return found;
}

const ci = parseWorkflow(readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8'));

/** The `target → example` map the job's install step reads from a JSON literal in its `env`. */
function installedExamples(): Record<string, string> {
  const job = (ci['jobs'] as Record<string, { steps?: { env?: Record<string, string> }[] }>)[JOB];
  const expression = job?.steps?.map((step) => step.env?.['EXAMPLE']).find(Boolean) ?? '';
  const literal = /fromJSON\('(.+)'\)\[matrix\.target\]/u.exec(expression)?.[1] ?? '{}';
  return JSON.parse(literal) as Record<string, string>;
}

describe('the real-admin targets', () => {
  it('are all in the matrix of the job that runs them on every push', () => {
    const configured = Object.keys(configuredExamples()).sort();
    expect(configured.length).toBeGreaterThan(0);
    expect(matrixValues(ci, JOB, 'target').map(String).sort()).toEqual(configured);
  });

  it('install in CI the example the config starts for them', () => {
    expect(installedExamples()).toEqual(configuredExamples());
  });
});
