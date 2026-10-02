/**
 * How a bound region is brought up to date: the runtime patches it, a server
 * renders a `data-payload-fragment` boundary from the unsaved form state, or
 * the whole route refreshes. Core carries only the seam — which boundaries a
 * strategy owns and what it may do — so a patch-only page pays for nothing
 * more; the orchestration lives in `payload-live-preview/fragment`.
 */
import type { DiagnosticCode } from './diagnostic-codes';

/** What produced an update: the runtime's DOM patching, a server-rendered fragment, or a route refresh. */
export type UpdateSource = 'patch' | 'fragment' | 'route';

/** Marks a server-rendered boundary; the value is the registry id the server may render. @internal */
export const FRAGMENT_ATTRIBUTE = 'data-payload-fragment';
/** Distinguishes several boundaries of one registry id; unique among siblings. @internal */
export const FRAGMENT_KEY_ATTRIBUTE = 'data-payload-fragment-key';

/** The nearest fragment boundary enclosing `element` (the element itself included). */
export function enclosingFragment(element: Element): Element | null {
  return element.closest(`[${FRAGMENT_ATTRIBUTE}]`);
}

/**
 * Where a render planned for `planned` lands. A host component that re-renders
 * its region while the render is in flight swaps the element and keeps the
 * identity, so a boundary no longer in the document stands for the one that
 * is: the single connected boundary with its id and key that `inScope` admits.
 * Two candidates name no single region, and none means it is gone (H06).
 */
export function liveBoundary(
  root: Document | Element,
  planned: Element,
  inScope: (boundary: Element) => boolean,
): Element | undefined {
  if (planned.isConnected) return planned;
  const id = planned.getAttribute(FRAGMENT_ATTRIBUTE);
  const key = planned.getAttribute(FRAGMENT_KEY_ATTRIBUTE);
  let found: Element | undefined;
  for (const candidate of root.querySelectorAll(`[${FRAGMENT_ATTRIBUTE}]`)) {
    if (candidate.getAttribute(FRAGMENT_ATTRIBUTE) !== id) continue;
    if (candidate.getAttribute(FRAGMENT_KEY_ATTRIBUTE) !== key || !inScope(candidate)) continue;
    if (found !== undefined) return undefined;
    found = candidate;
  }
  return found;
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
  /** Morph server-rendered HTML into a boundary; no-op after supersession (Trusted Types and the keyed morph apply). */
  readonly morph: (boundary: Element, html: string) => void;
  /** Patch the boundary's owned bindings from this revision; no-op after supersession. */
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
  /** Aborted when a newer revision asks for a refresh of its own, a navigation commits, or the runtime stops. */
  readonly signal: AbortSignal;
  /**
   * Whether the refresh may still land. A newer revision that asks for no
   * refresh of its own does not end it: the route is the server's, so the
   * refresh lands for that revision, which the runtime then re-applies.
   */
  readonly isCurrent: () => boolean;
  readonly log: (code: DiagnosticCode, detail: string) => void;
  /**
   * Ask to be run again in `delayMs`, once. A strategy that refuses a refresh
   * because it is rate-limiting itself uses this: the window is a rate limit
   * and not a filter, so what falls inside it still has to reach the preview.
   * The runtime runs at most one such request, and only while the revision that
   * asked is still the current one.
   */
  readonly retryAfter?: (delayMs: number) => void;
}

/**
 * What one refresh did. `refreshed` asserts that the strategy rendered the
 * current unsaved revision. `partial` completed a render whose data source was
 * not proven current; the runtime still reapplies every binding it can reach.
 * `refused` is the strategy's own brake and not a failure.
 */
export type RouteOutcome = 'refreshed' | 'partial' | 'failed' | 'refused' | 'superseded';

/** What the runtime tells a route planner about the update it plans for. */
export interface RoutePlanContext {
  /**
   * Whether an element belongs to the update: always `true` without
   * `scopeBindingsByOwner`, otherwise only inside the document the update
   * names. A marker outside it asks for nothing.
   */
  readonly inScope: (element: Element) => boolean;
}

/**
 * Whether a revision needs the whole route re-rendered, and how. After a
 * refresh the runtime rescans and re-applies the revision, so reachable
 * unsaved bindings land on the fresh markup. The runtime always passes
 * `context`; a planner written before it existed still works, but plans for
 * markers of every document.
 */
export interface RouteStrategy {
  readonly plan: (
    root: ParentNode,
    changedFields: ReadonlySet<string>,
    context?: RoutePlanContext,
  ) => boolean;
  readonly refresh: (context: RouteContext) => Promise<RouteOutcome>;
}

export interface StrategyHandlers {
  readonly fragment?: FragmentStrategy;
  readonly route?: RouteStrategy;
}

const STRATEGY_ATTRIBUTE = 'data-payload-strategy';

/**
 * Explicit `data-payload-strategy` wins; otherwise a binding inside a fragment
 * boundary belongs to the fragment, one in `<head>` to the route, the rest is
 * patched. An unknown explicit value resolves to `undefined` (LP0407).
 * @internal
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
