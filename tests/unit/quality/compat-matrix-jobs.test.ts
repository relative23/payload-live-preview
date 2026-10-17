import { describe, expect, it } from 'vitest';
import {
  MATRIX_JOBS,
  matrixJobProblems,
  type RecordedFramework,
} from '../../../scripts/compat-matrix-jobs';

/**
 * A framework's older majors are tested by a matrix job that installs them over the fixture. The
 * compatibility record lists those majors in the README, so the list and the job's matrix have to be
 * the same list. These are the comparisons, against records and workflows invented for each case.
 */

const record = (
  next: readonly number[],
  astro: readonly number[] = [6, 5, 4],
): RecordedFramework[] => [
  {
    package: 'astro',
    tested: [{ source: 'lockfile' }, ...astro.map((major) => ({ source: 'astro-matrix', major }))],
  },
  {
    package: 'next',
    tested: [{ source: 'lockfile' }, ...next.map((major) => ({ source: 'next-matrix', major }))],
  },
  { package: '@sveltejs/kit', tested: [{ source: 'lockfile' }] },
];
const workflow =
  (values: Readonly<Record<string, readonly string[]>>) =>
  (job: string, key: string): readonly string[] =>
    values[`${job}.${key}`] ?? [];

describe('the matrix jobs of the compatibility record', () => {
  it('names one job for Astro and one for Next.js', () => {
    expect(MATRIX_JOBS.map((job) => [job.package, job.job, job.key])).toEqual([
      ['astro', 'astro-matrix', 'astro'],
      ['next', 'next-matrix', 'next'],
    ]);
  });

  it('has nothing to say when each job installs the majors the record lists', () => {
    const installed = workflow({
      'astro-matrix.astro': ['6', '5', '4'],
      'next-matrix.next': ['15'],
    });
    expect(matrixJobProblems(record([15]), installed)).toEqual([]);
  });

  it('names the Next.js matrix when the record lists a major the workflow does not install', () => {
    const installed = workflow({ 'astro-matrix.astro': ['6', '5', '4'] });
    expect(matrixJobProblems(record([15]), installed)).toEqual([
      'Next.js matrix: file lists [15], workflow runs []',
    ]);
  });

  it('names the Next.js matrix when the workflow installs a major the record does not list', () => {
    const installed = workflow({
      'astro-matrix.astro': ['6', '5', '4'],
      'next-matrix.next': ['15', '14'],
    });
    expect(matrixJobProblems(record([15]), installed)).toEqual([
      'Next.js matrix: file lists [15], workflow runs [15, 14]',
    ]);
  });

  it('names the Astro matrix when the workflow runs fewer majors than the record lists', () => {
    const installed = workflow({ 'astro-matrix.astro': ['6'], 'next-matrix.next': ['15'] });
    expect(matrixJobProblems(record([15]), installed)).toEqual([
      'Astro matrix: file lists [6, 5, 4], workflow runs [6]',
    ]);
  });

  it('keeps the order the reviewed workflow runs them in', () => {
    const installed = workflow({
      'astro-matrix.astro': ['4', '5', '6'],
      'next-matrix.next': ['15'],
    });
    expect(matrixJobProblems(record([15]), installed)).toEqual([
      'Astro matrix: file lists [6, 5, 4], workflow runs [4, 5, 6]',
    ]);
  });

  it('reads a framework the record does not list at all as having no majors', () => {
    const installed = workflow({
      'astro-matrix.astro': ['6', '5', '4'],
      'next-matrix.next': ['15'],
    });
    expect(matrixJobProblems([], installed)).toEqual([
      'Astro matrix: file lists [], workflow runs [6, 5, 4]',
      'Next.js matrix: file lists [], workflow runs [15]',
    ]);
  });
});
