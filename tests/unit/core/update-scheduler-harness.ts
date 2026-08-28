/**
 * Binding and update builders for the `UpdateScheduler` suites. Importing this
 * module installs the fake-timer hooks the debounce assertions rely on.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { type ScheduledUpdate } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';

export function entry(element: Element, fieldName = 'f'): CachedElement {
  return { element, fieldName, fieldType: 'text' };
}

export function update(target: CachedElement, value: unknown): ScheduledUpdate {
  return { target, value, allFields: {} };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
