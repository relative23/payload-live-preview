/**
 * The issue helper is also loaded directly by the dependency-free report job.
 * These declarations keep its input types available to TypeScript consumers.
 */
export function fileIssue(issue: {
  readonly label: string;
  readonly labelDescription: string;
  readonly title: string;
  readonly body: string;
  readonly log: string;
}): void;
