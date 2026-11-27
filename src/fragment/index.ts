/**
 * `payload-live-preview/fragment` — the fragment and route strategies. The
 * core carries only the seam (`@core/strategies`); this entry owns the
 * orchestration (`./strategy`, `./route`). See ADR 0011.
 */

export type {
  FragmentBoundary,
  FragmentHandler,
  FragmentOutcome,
  StrategyRequest,
} from './boundary';
export type { FragmentStrategyOptions } from './handler';
export type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteContext,
  RouteOutcome,
  RoutePlanContext,
  RouteStrategy,
  StrategyHandlers,
  UpdateSource,
} from '@core/strategies/strategies';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '@core/diagnostic-codes';
export { createRouteStrategy, type RouteStrategyOptions } from './route';
export type { FragmentRequestBody, FragmentResponseBody } from '@/types/fragment-protocol';
// Last, where this entry's own code stood before it moved: the minifier names symbols in module order, and
// with `./strategy` first the entries that embed both preludes grew by 166 to 189 B gzip at the same raw size.
export { createFragmentStrategy } from './strategy';
