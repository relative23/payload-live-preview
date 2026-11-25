/**
 * `payload-live-preview/fragment` — the fragment and route strategies. The
 * core carries only the seam (`@core/strategies`); this entry owns the
 * orchestration (`./strategy`, `./route`). See ADR 0011.
 */

export {
  collectFragmentBoundaries,
  describeBoundary,
  FRAGMENT_KEY_ATTRIBUTE,
  type FragmentBoundary,
  type FragmentHandler,
  type FragmentOutcome,
  type StrategyRequest,
} from './boundary';
export { createFragmentHandler, type FragmentStrategyOptions } from './handler';
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
export { FRAGMENT_ATTRIBUTE, resolveStrategy } from '@core/strategies/strategies';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '@core/diagnostic-codes';
export {
  createRouteStrategy,
  isRouteBound,
  ROUTE_REFRESH_HEADER,
  type RouteStrategyOptions,
} from './route';
export {
  FRAGMENT_PROTOCOL_VERSION,
  FRAGMENT_VERSION_HEADER,
  parseFragmentRequest,
  parseFragmentResponse,
  type FragmentRequestBody,
  type FragmentResponseBody,
} from '@/types/fragment-protocol';
// Last, where this entry's own code stood before it moved: the minifier names symbols in module order, and
// with `./strategy` first the entries that embed both preludes grew by 166 to 189 B gzip at the same raw size.
export { createFragmentStrategy, fragmentStrategyFrom } from './strategy';
