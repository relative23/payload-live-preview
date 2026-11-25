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

const record = (next: readonly number[]): RecordedFramework[] => [
  { package: 'astro', tested: [{ source: 'lockfile' }] },
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

describe('the majors a matrix job installs against the majors the record lists', () => {
  it('knows the one job that installs an older major', () => {
    expect(MATRIX_JOBS.map((job) => [job.package, job.job, job.key])).toEqual([
      ['next', 'next-matrix', 'next'],
    ]);
  });

  it('has nothing to say when the job installs the majors the record lists', () => {
    expect(matrixJobProblems(record([15]), workflow({ 'next-matrix.next': ['15'] }))).toEqual([]);
  });

  it('names the matrix when the record lists a major the workflow does not install', () => {
    expect(matrixJobProblems(record([15]), workflow({}))).toEqual([
      'Next.js matrix: file lists [15], workflow runs []',
    ]);
  });

  it('names the matrix when the workflow installs a major the record does not list', () => {
    const installed = workflow({ 'next-matrix.next': ['15', '14'] });
    expect(matrixJobProblems(record([15]), installed)).toEqual([
      'Next.js matrix: file lists [15], workflow runs [15, 14]',
    ]);
  });

  it('names the matrix when the workflow runs fewer majors than the record lists', () => {
    const installed = workflow({ 'next-matrix.next': ['15'] });
    expect(matrixJobProblems(record([15, 14, 13]), installed)).toEqual([
      'Next.js matrix: file lists [15, 14, 13], workflow runs [15]',
    ]);
  });

  it('keeps the order the reviewed workflow runs them in', () => {
    const installed = workflow({ 'next-matrix.next': ['13', '14', '15'] });
    expect(matrixJobProblems(record([15, 14, 13]), installed)).toEqual([
      'Next.js matrix: file lists [15, 14, 13], workflow runs [13, 14, 15]',
    ]);
  });

  it('reads a framework the record does not list at all as having no majors', () => {
    expect(matrixJobProblems([], workflow({ 'next-matrix.next': ['15'] }))).toEqual([
      'Next.js matrix: file lists [], workflow runs [15]',
    ]);
  });
});
