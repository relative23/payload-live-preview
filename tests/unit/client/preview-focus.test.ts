import { describe, expect, it } from 'vitest';
import {
  createPreviewFocusReporter,
  reportPreviewFocus,
  type FocusReportTarget,
} from '@client/preview-focus';

/** A target that records every postMessage call, typed as the real interface. */
function recorder(): FocusReportTarget & { calls: { message: unknown; origin: string }[] } {
  const calls: { message: unknown; origin: string }[] = [];
  return {
    calls,
    postMessage: (message: unknown, targetOrigin: string) => {
      calls.push({ message, origin: targetOrigin });
    },
  };
}

describe('reportPreviewFocus', () => {
  it('posts a typed focus message to the exact origin, skipping empty fields', () => {
    const target = recorder();
    reportPreviewFocus(target, 'heroTitle', 'https://preview.example.com');
    expect(target.calls).toEqual([
      {
        message: { type: 'payload-live-preview-focus', field: 'heroTitle' },
        origin: 'https://preview.example.com',
      },
    ]);
    reportPreviewFocus(target, '', 'https://preview.example.com');
    expect(target.calls).toHaveLength(1);
  });
});

describe('createPreviewFocusReporter', () => {
  it('resolves the target per call and no-ops when the preview is not open', () => {
    let target: ReturnType<typeof recorder> | null = null;
    const report = createPreviewFocusReporter(() => target, 'https://preview.example.com');
    report('title'); // no target yet → no-op
    target = recorder();
    report('title');
    expect(target.calls).toHaveLength(1);
  });
});
