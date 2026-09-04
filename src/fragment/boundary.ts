/** Fragment boundaries: how a `data-payload-fragment` element is read and which ones an update touches. */

import type { DiagnosticCode } from '@core/diagnostic-codes';
import { isInsideIsland } from '@core/islands';
import { parseDependencyList } from '@core/dependencies';
import { FRAGMENT_ATTRIBUTE } from '@core/strategies';

/** Distinguishes several boundaries of one registry id; unique among siblings. */
export const FRAGMENT_KEY_ATTRIBUTE = 'data-payload-fragment-key';
const DEPENDS_ATTRIBUTE = 'data-payload-depends';

export interface FragmentBoundary {
  readonly element: Element;
  /** Registry id — never a path, module or function name. */
  readonly id: string;
  readonly key: string | undefined;
  /** Fields whose change re-renders the boundary; empty means any field. */
  readonly dependsOn: readonly string[];
}

/** One revision's request to a per-boundary handler. */
export interface StrategyRequest {
  readonly revision: number;
  readonly receivedAt: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly locale: string | undefined;
  readonly collectionSlug: string | undefined;
  readonly globalSlug: string | undefined;
  /** Aborted when a newer revision arrives or the runtime stops. */
  readonly signal: AbortSignal;
}

export type FragmentOutcome =
  | {
      readonly status: 'rendered';
      /** The boundary's new inner HTML. */
      readonly html: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly status: 'failed'; readonly code: DiagnosticCode; readonly reason: string }
  | { readonly status: 'superseded' };

/** Renders one boundary for one revision. Must honour `request.signal`. */
export type FragmentHandler = (
  request: StrategyRequest,
  boundary: FragmentBoundary,
) => Promise<FragmentOutcome>;

export function describeBoundary(element: Element): FragmentBoundary | null {
  const id = element.getAttribute(FRAGMENT_ATTRIBUTE);
  if (id === null || id.length === 0) return null;
  const key = element.getAttribute(FRAGMENT_KEY_ATTRIBUTE);
  return {
    element,
    id,
    key: key === null || key.length === 0 ? undefined : key,
    dependsOn: parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE)),
  };
}

/** The boundaries under `root` that `changedFields` touch; one inside an island is the island's business. */
export function collectFragmentBoundaries(
  root: ParentNode,
  changedFields: ReadonlySet<string>,
): readonly FragmentBoundary[] {
  const boundaries: FragmentBoundary[] = [];
  for (const element of root.querySelectorAll(`[${FRAGMENT_ATTRIBUTE}]`)) {
    const boundary = describeBoundary(element);
    if (boundary === null || isInsideIsland(element)) continue;
    if (
      boundary.dependsOn.length > 0 &&
      !boundary.dependsOn.some((field) => changedFields.has(field))
    ) {
      continue;
    }
    boundaries.push(boundary);
  }
  return boundaries;
}
