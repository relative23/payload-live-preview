/**
 * The affected graph is hashed before any temporary exception can be applied.
 * Native-JavaScript implementation types are checked separately from this
 * declaration, and the TypeScript CLI retains the same structural finding shape.
 */
export interface AuditGraphFinding {
  readonly id: string;
  readonly package: string;
  readonly severity: string;
  readonly advisoryPackage?: string;
}
export function advisoryGraph(
  audit: unknown,
  lock: unknown,
  findings: readonly AuditGraphFinding[],
  leaf: string,
  id: string,
): { sha256: string; version: string; integrity: string };
