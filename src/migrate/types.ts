/** Shapes shared by the codemods, the driver and the runner. Types only. */
import type { SourceFile } from 'ts-morph';

/** One splice into a script, in source offsets. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Something a codemod could not rewrite safely, for a human to resolve. */
export interface CodemodConflict {
  readonly codemod: string;
  readonly reason: string;
  /** 1-based line in the file, when the conflict has one. */
  readonly line?: number;
}

/** What a codemod wants done to one script. */
export interface CodemodPlan {
  readonly edits: readonly TextEdit[];
  readonly conflicts: readonly CodemodConflict[];
}

/**
 * One codemod, as the public surface describes it. The rewrite itself is
 * internal: typing it would put `ts-morph` — an optional peer, needed only to
 * *run* `pll migrate` — into the type surface of everyone who imports this
 * entry.
 */
export interface Codemod {
  /** Stable id, e.g. `rename-is-preview-request`. */
  readonly id: string;
  readonly summary: string;
  /** The ADR 0007 ledger entry this codemod implements. */
  readonly ledgerEntry: number;
}

/** A codemod with its implementation; internal, so `ts-morph` stays off the public surface. */
export interface CodemodImplementation extends Codemod {
  /** Plan the rewrite of one parsed script; the driver applies the edits. */
  readonly apply: (script: SourceFile) => CodemodPlan;
}

/** One changed line, before and after. */
export interface CodemodLineEdit {
  readonly line: number;
  readonly before: string;
  readonly after: string;
}

/** What one codemod changed in one file. */
export interface CodemodEdit {
  readonly codemod: string;
  /** Changed lines, insertions and deletions included. */
  readonly count: number;
  readonly lines: readonly CodemodLineEdit[];
}
