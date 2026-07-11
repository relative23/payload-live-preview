/**
 * `analytics` plugin — accumulates summary statistics about the
 * update stream. Useful for performance dashboards.
 *
 * The plugin owns its own state (no module singleton) and exposes it
 * via the `getStats` factory passed through the plugin's `init` hook
 * by closing over a local object.
 *
 * @module @plugins/built-in/analytics
 */

import type { LivePreviewPlugin } from '../types';

export interface AnalyticsSnapshot {
  readonly updateCount: number;
  readonly totalElements: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
}

export function createAnalyticsPlugin(): LivePreviewPlugin & {
  readonly getStats: () => AnalyticsSnapshot;
} {
  let updateCount = 0;
  let totalElements = 0;
  let totalDurationMs = 0;

  return {
    name: 'analytics',
    version: '1.0.0',
    init: (ctx) => {
      ctx.events.on('afterUpdate', (e) => {
        updateCount += 1;
        totalElements += e.updatedCount;
        totalDurationMs += e.durationMs;
      });
    },
    getStats: (): AnalyticsSnapshot => ({
      updateCount,
      totalElements,
      totalDurationMs,
      averageDurationMs: updateCount === 0 ? 0 : totalDurationMs / updateCount,
    }),
  };
}
