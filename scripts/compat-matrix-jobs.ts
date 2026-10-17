/**
 * The CI jobs that install an older major of a framework over its fixture, and the comparison that
 * keeps the compatibility record honest about them: the majors the record lists for such a framework
 * are the majors the job's matrix installs, in the same order, no more and no fewer. A pure module so
 * the comparison can be tested against records and workflows invented for each case.
 */

export interface MatrixJob {
  /** The framework's package, as the record names it. */
  readonly package: string;
  /** What a tested row of the record calls this job as its `source`. */
  readonly source: string;
  /** The workflow job and the matrix key that holds the majors it installs. */
  readonly job: string;
  readonly key: string;
  /** The job's name in a message. */
  readonly label: string;
}

export const MATRIX_JOBS = [
  {
    package: 'astro',
    source: 'astro-matrix',
    job: 'astro-matrix',
    key: 'astro',
    label: 'Astro matrix',
  },
  {
    package: 'next',
    source: 'next-matrix',
    job: 'next-matrix',
    key: 'next',
    label: 'Next.js matrix',
  },
] as const satisfies readonly MatrixJob[];

/** The part of a framework row this comparison reads. */
export interface RecordedFramework {
  readonly package: string;
  readonly tested: readonly { readonly source: string; readonly major?: number }[];
}

/** Every matrix job whose majors the record and the workflow disagree about. */
export function matrixJobProblems(
  frameworks: readonly RecordedFramework[],
  workflowValues: (job: string, key: string) => readonly string[],
): readonly string[] {
  return MATRIX_JOBS.flatMap((matrix) => {
    const listed =
      frameworks
        .find((framework) => framework.package === matrix.package)
        ?.tested.filter((entry) => entry.source === matrix.source)
        .map((entry) => String(entry.major)) ?? [];
    const installed = workflowValues(matrix.job, matrix.key);
    return listed.join(',') === installed.join(',')
      ? []
      : [
          `${matrix.label}: file lists [${listed.join(', ')}], workflow runs [${installed.join(', ')}]`,
        ];
  });
}
