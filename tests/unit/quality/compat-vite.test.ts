import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  majorSpan,
  majorsIn,
  peerCoverageProblems,
  peerMajorSpan,
  renderViteLine,
  viteProblems,
  type ViteFacts,
} from '../../../scripts/compat-vite';

/**
 * On 2026-09-06 the devDependency stood at Vite 7 while every fixture lockfile
 * installed Vite 8, because three of the four supported Astro majors pull it.
 * Nothing failed, because nothing compared the two. These are the comparisons,
 * against a matrix invented for each case so a real one cannot make them pass.
 */

const RECORDED = [
  { framework: 'Astro', major: 7, range: '^8.0.13' },
  { framework: 'Astro', major: 6, range: '^7.3.2' },
  { framework: 'Astro', major: 4, range: '^5.4.11' },
];
const facts = (overrides: Partial<ViteFacts> = {}): ViteFacts => ({
  recorded: RECORDED,
  dev: '^8.2.2',
  lockfiles: [{ fixture: 'examples/astro-payload', version: '8.2.2' }],
  ...overrides,
});

describe('reading majors out of a range', () => {
  it('takes every major a range mentions', () => {
    expect(majorsIn('^5.0.3 || ^6.0.0 || ^7.0.0-beta.0 || ^8.0.0')).toEqual([5, 6, 7, 8]);
    expect(majorSpan(['^5.4.11', '^8.0.13'])).toEqual({ min: 5, max: 8 });
  });

  it('reads a peer range as the majors it allows, exclusive upper bound and all', () => {
    expect(peerMajorSpan('>=4.0.0 <8.0.0')).toEqual({ min: 4, max: 7 });
    // `<8.1.0` does allow 8; only a `.0` boundary excludes the whole major.
    expect(peerMajorSpan('>=4.0.0 <8.1.0')).toEqual({ min: 4, max: 8 });
    expect(peerMajorSpan('2.x')).toBeUndefined();
  });
});

describe('what compat:check refuses', () => {
  it('a devDependency behind the newest major, with nothing said about it', () => {
    const problems = viteProblems(facts({ dev: '^7.3.6' }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Astro 7 installs Vite 8');
    expect(problems[0]).toContain('devBelowNewest');
  });

  it('accepts the same gap once the reason is recorded', () => {
    // The first version of this gate demanded the newest major and was wrong
    // within a day: a dev plugin peered below Vite 8, `npm ci` failed with
    // ERESOLVE, and CI stopped before its first test. Which major the
    // repository develops against is a fact about its own tooling.
    expect(
      viteProblems(facts({ dev: '^7.3.6', devBelowNewest: 'a dev plugin peers below 8' })),
    ).toEqual([]);
  });

  it('refuses a devDependency outside the span whatever the reason says', () => {
    const problems = viteProblems(
      facts({
        dev: '^4.0.0',
        devBelowNewest: 'no reason covers developing against a major nobody installs',
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('outside the recorded 5–8');
  });

  it('a peer range too narrow for a major the matrix tests', () => {
    const problems = peerCoverageProblems(
      [{ name: 'Astro', package: 'astro', majors: [4, 6, 7, 8] }],
      { astro: '>=4.0.0 <8.0.0' },
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not cover');
  });

  it('a fixture lockfile outside the recorded span', () => {
    const problems = viteProblems(
      facts({ lockfiles: [{ fixture: 'examples/astro-payload', version: '9.0.1' }] }),
    );

    expect(problems).toEqual([
      'Vite: examples/astro-payload installs 9.0.1, outside the recorded 5–8',
    ]);
  });

  it('accepts the arrangement it is meant to accept', () => {
    expect(viteProblems(facts())).toEqual([]);
    expect(
      peerCoverageProblems([{ name: 'Astro', package: 'astro', majors: [4, 7] }], {
        astro: '>=4.0.0 <8.0.0',
      }),
    ).toEqual([]);
  });

  it('says nothing about a framework that is not an optional peer', () => {
    // Next.js and Nuxt are supported without being declared peers; a range that
    // does not exist cannot be too narrow.
    expect(
      peerCoverageProblems([{ name: 'Next.js', package: 'next', majors: [15, 16] }], {}),
    ).toEqual([]);
  });
});

describe('the sentence in the README', () => {
  it('is built from the record, not written beside it', () => {
    const line = renderViteLine(facts(), '2026-09-06');

    expect(line).toContain('Vite 5 through 8');
    expect(line).toContain('Astro 7 → 8');
    expect(line).toContain('measured 2026-09-06');
  });

  it('is the line the README actually carries', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../../../README.md'), 'utf8');

    expect(readme).toContain('Vite 5 through 8');
  });
});

describe('the gate itself', () => {
  it('reaches the network only to refresh, never to check', () => {
    // A gate that needs the registry fails on a plane, and the question it
    // answers is answerable from the repository alone.
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../scripts/compat-table.ts'),
      'utf8',
    );
    const section = (from: string, to: string): string =>
      source.slice(source.indexOf(from), source.indexOf(to));

    // One call site, and it is the one named after what it does.
    expect(source.split("run('npm', ['view'").length - 1).toBe(1);
    expect(section('async function declaredVite(', 'async function refresh(')).toContain(
      "run('npm', ['view'",
    );
    // `validate()` is everything `--check` runs, and it reaches neither.
    const validate = section('async function validate(', '// Prettier re-pads table cells');
    expect(validate).not.toContain('declaredVite');
    expect(validate).not.toContain("run('npm'");
  });
});
