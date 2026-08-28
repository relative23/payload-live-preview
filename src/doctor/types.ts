/** Shapes for the `pll doctor` audit. Types only. */
import type { DiagnosticCode } from '../core/diagnostic-codes';

export type DoctorLevel = 'error' | 'warning' | 'info';

/** One thing the audit noticed about what the site actually served. */
export interface DoctorFinding {
  readonly code: DiagnosticCode;
  readonly level: DoctorLevel;
  /** One line, the problem itself. */
  readonly title: string;
  /** What was observed, in terms of the actual response. */
  readonly detail: string;
  /** What to change. Empty for informational findings that need no action. */
  readonly remedy: string;
}

/** A response as plain data, so the analysis is testable without a network. */
export interface DoctorResponse {
  readonly status: number;
  /** Header names lowercased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The two fetches the audit compares. */
export interface DoctorProbe {
  /** The page as an ordinary visitor sees it: no preview intent, no admin referer. */
  readonly publicResponse: DoctorResponse;
  /** The same page requested the way the admin's iframe requests it. */
  readonly previewResponse: DoctorResponse;
}

/** What the audit was told about the deployment it is checking. */
export interface DoctorContext {
  readonly url: string;
  /** The admin origin the preview is embedded from; without it `frame-ancestors` can only be checked for presence. */
  readonly adminOrigin?: string | undefined;
}

export interface DoctorReport {
  readonly url: string;
  /** Findings, most severe first. */
  readonly findings: readonly DoctorFinding[];
  readonly errors: number;
  readonly warnings: number;
}
