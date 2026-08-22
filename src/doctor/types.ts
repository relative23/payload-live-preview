/**
 * Shapes for the `pll doctor` audit.
 *
 * This module is types only.
 *
 * @module @doctor/types
 */
import type { DiagnosticCode } from '../core/diagnostic-codes';

/** How much a finding should worry the reader. */
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

/**
 * A response as the audit needs to see it. Modelled as plain data rather than
 * a `Response` so the analysis is testable without a network or a fetch
 * implementation.
 */
export interface DoctorResponse {
  readonly status: number;
  /** Header names lowercased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The two fetches the audit compares. */
export interface DoctorProbe {
  /**
   * The page as an ordinary visitor sees it: no preview intent, no admin
   * referer, top-level navigation.
   */
  readonly publicResponse: DoctorResponse;
  /**
   * The same page requested the way the admin's iframe requests it, which is
   * what triggers `'preview-only'` injection.
   */
  readonly previewResponse: DoctorResponse;
}

/** What the audit was told about the deployment it is checking. */
export interface DoctorContext {
  /** The page that was probed. */
  readonly url: string;
  /**
   * The admin origin the preview is supposed to be embedded from, when the
   * caller supplied one. Without it the `frame-ancestors` check can only say
   * whether a policy exists, not whether it admits the right origin.
   */
  readonly adminOrigin?: string | undefined;
}

/** The complete audit result. */
export interface DoctorReport {
  readonly url: string;
  /** Findings, most severe first. */
  readonly findings: readonly DoctorFinding[];
  /** Counts by level, for the exit code and the summary line. */
  readonly errors: number;
  readonly warnings: number;
}
