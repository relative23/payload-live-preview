/**
 * The modules of the fragment prelude, listed as the public entry listed them
 * until 3.0, names and types alike. The build reads this list, not the entry.
 * The minifier names symbols by the modules' order and by the text it reads,
 * and the route prelude holds the same route code: where the names differ
 * between the two, the scripts that embed both preludes grow at the same raw
 * size. Measured on 2026-11-27: read from the entry's shorter list, +174 B
 * gzip in the generator's bundle; with the same modules in this order but
 * without the type names, 134 characters of the prelude under other names;
 * with this list, the prelude byte for byte as before. The public entry
 * exports a project's names now (ADR 0007, row 15).
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
} from '@/runtime/types/fragment-protocol';
// Last, where this entry's own code stood before it moved: the minifier names symbols in module order, and
// with `./strategy` first the entries that embed both preludes grew by 166 to 189 B gzip at the same raw size.
export { createFragmentStrategy, fragmentStrategyFrom } from './strategy';
