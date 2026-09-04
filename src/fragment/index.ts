/**
 * `payload-live-preview/fragment` — the fragment and route strategies. The
 * core carries only the seam (`@core/strategies`); this entry owns the
 * orchestration and never sends code, paths or templates. See ADR 0011.
 */

import type { FragmentContext, FragmentReport, FragmentStrategy } from '@core/strategies';
import {
  collectFragmentBoundaries,
  describeBoundary,
  type FragmentHandler,
  type FragmentOutcome,
  type StrategyRequest,
} from './boundary';
import { createFragmentHandler, type FragmentStrategyOptions } from './handler';

export type {
  FragmentContext,
  FragmentReport,
  FragmentStrategy,
  RouteContext,
  RouteStrategy,
  StrategyHandlers,
  UpdateSource,
} from '@core/strategies';
export { FRAGMENT_ATTRIBUTE, resolveStrategy } from '@core/strategies';
export { DIAGNOSTIC_CODES, type DiagnosticCode } from '@core/diagnostic-codes';
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

/**
 * The strategy the runtime drives, built on a per-boundary handler: plan the
 * boundaries, render each, morph a success, patch a failure. A late or
 * aborted render is dropped, never applied.
 */
export function fragmentStrategyFrom(handler: FragmentHandler): FragmentStrategy {
  return {
    plan: (root, changedFields) =>
      collectFragmentBoundaries(root, changedFields).map((boundary) => boundary.element),
    async render(context: FragmentContext, elements: readonly Element[]): Promise<FragmentReport> {
      const report = { rendered: 0, failed: 0, superseded: 0 };
      const request: StrategyRequest = {
        revision: context.revision,
        receivedAt: context.receivedAt,
        fields: context.fields,
        locale: context.locale,
        collectionSlug: context.collectionSlug,
        globalSlug: context.globalSlug,
        signal: context.signal,
      };
      await Promise.all(
        elements.map(async (element) => {
          const boundary = describeBoundary(element);
          if (boundary === null) return;
          let outcome: FragmentOutcome;
          try {
            outcome = await handler(request, boundary);
          } catch (error) {
            outcome = {
              status: 'failed',
              code: 'LP0801',
              reason: error instanceof Error ? error.message : String(error),
            };
          }
          if (!context.isCurrent() || outcome.status === 'superseded') {
            report.superseded += 1;
            context.log(
              'LP0804',
              `fragment "${boundary.id}" for revision ${String(request.revision)} discarded as superseded`,
            );
            return;
          }
          if (outcome.status === 'rendered') {
            context.morph(element, outcome.html);
            context.rendered(element, boundary.id, boundary.key);
            report.rendered += 1;
            return;
          }
          context.failed(element, boundary.id, boundary.key, outcome.code, outcome.reason);
          if (context.isCurrent()) context.patch(element);
          report.failed += 1;
        }),
      );
      return report;
    },
  };
}

/** The strategy for a fragment endpoint: hand it to the runtime as `strategies.fragment`. */
export function createFragmentStrategy(options: FragmentStrategyOptions): FragmentStrategy {
  return fragmentStrategyFrom(createFragmentHandler(options));
}
