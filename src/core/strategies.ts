/**
 * Update strategies (roadmap 1.6.0 / 1.7.0): how a bound region is brought
 * up to date. `patch` is the runtime's own DOM patching; `fragment` asks a
 * server to render a component boundary from the unsaved form state and
 * morphs the result in; `route` refreshes the whole route.
 *
 * The core carries only the seam below — which boundaries a strategy owns
 * for a revision, and the capabilities it may use (morph, fallback patch,
 * events) — so a patch-only page pays for the seam and nothing else. The
 * orchestration (requests, dedupe, timeouts, error mapping) lives in
 * `payload-live-preview/fragment`.
 *
 * @module @core/strategies
 */
import type { DiagnosticCode } from './diagnostic-codes';

/** What produced an update: the runtime's DOM patching, a server-rendered fragment, or a route refresh. */
export type UpdateSource = 'patch' | 'fragment' | 'route';

/** Marks a server-rendered boundary; the value is the registry id the server may render. */
export const FRAGMENT_ATTRIBUTE = 'data-payload-fragment';

/** The nearest fragment boundary enclosing `element` (the element itself included). */
export function enclosingFragment(element: Element): Element | null {
  return element.closest(`[${FRAGMENT_ATTRIBUTE}]`);
}

/** One revision, as a strategy sees it, with the runtime capabilities it may use. */
export interface FragmentContext {
  readonly root: ParentNode;
  readonly revision: number;
  readonly receivedAt: number;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly locale: string | undefined;
  readonly collectionSlug: string | undefined;
  readonly globalSlug: string | undefined;
  /** Aborted when a newer revision arrives or the runtime stops. */
  readonly signal: AbortSignal;
  /** Whether this revision is still the current one. */
  readonly isCurrent: () => boolean;
  /** Morph server-rendered HTML into a boundary (Trusted Types and the keyed morph apply). */
  readonly morph: (boundary: Element, html: string) => void;
  /** Patch the boundary's own bindings from this revision — the deterministic fallback. */
  readonly patch: (boundary: Element) => void;
  /** Debug log through the runtime's logger, with the diagnostic code. */
  readonly log: (code: DiagnosticCode, detail: string) => void;
  /** Report a boundary rendered. */
  readonly rendered: (boundary: Element, id: string, key: string | undefined) => void;
  /** Report a boundary failed and patched instead; emits the `error` and `fragmentRender` events. */
  readonly failed: (
    boundary: Element,
    id: string,
    key: string | undefined,
    code: DiagnosticCode,
    reason: string,
  ) => void;
}

export interface FragmentReport {
  readonly rendered: number;
  readonly failed: number;
  readonly superseded: number;
}

/** A fragment strategy: which boundaries it owns for a revision, and how it renders them. */
export interface FragmentStrategy {
  /** The boundaries this update re-renders; their inner bindings are left to the strategy. */
  readonly plan: (root: ParentNode, changedFields: ReadonlySet<string>) => readonly Element[];
  /** Render the planned boundaries; resolves once every one settled. */
  readonly render: (
    context: FragmentContext,
    boundaries: readonly Element[],
  ) => Promise<FragmentReport>;
}

/** One revision, as the route strategy sees it. */
export interface RouteContext {
  readonly revision: number;
  readonly receivedAt: number;
  /** Aborted when a newer revision arrives or the runtime stops. */
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly log: (code: DiagnosticCode, detail: string) => void;
}

/**
 * A route strategy: whether a revision needs the whole route re-rendered
 * (head, layout, route params, providers), and how to refresh it in place.
 * After a refresh the runtime rescans and re-applies the revision, so the
 * unsaved state lands on the freshly rendered markup.
 */
export interface RouteStrategy {
  readonly plan: (root: ParentNode, changedFields: ReadonlySet<string>) => boolean;
  readonly refresh: (context: RouteContext) => Promise<'refreshed' | 'failed' | 'superseded'>;
}

export interface StrategyHandlers {
  readonly fragment?: FragmentStrategy;
  readonly route?: RouteStrategy;
}

const STRATEGY_ATTRIBUTE = 'data-payload-strategy';

/**
 * The strategy a bound element gets: explicit `data-payload-strategy` first;
 * otherwise a binding inside a fragment boundary belongs to the fragment, a
 * binding in `<head>` (title, meta) belongs to the route, and everything
 * else is patched. Unknown explicit values resolve to `undefined` so the
 * caller can say so (LP0407).
 */
export function resolveStrategy(element: Element): UpdateSource | undefined {
  const explicit = element.getAttribute(STRATEGY_ATTRIBUTE);
  if (explicit !== null && explicit.length > 0) {
    return explicit === 'patch' || explicit === 'fragment' || explicit === 'route'
      ? explicit
      : undefined;
  }
  if (enclosingFragment(element) !== null) return 'fragment';
  if (element.closest('head') !== null) return 'route';
  return 'patch';
}
