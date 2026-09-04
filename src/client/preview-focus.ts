/**
 * Admin-side reporter for "reveal the edited section": it names the field the
 * editor's cursor is in so the preview scrolls there without a keystroke.
 */

/** The preview window (usually `iframe.contentWindow`) messages are posted to. */
export interface FocusReportTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

export interface PreviewFocusMessage {
  readonly type: 'payload-live-preview-focus';
  readonly field: string;
}

/** Post one focus report. `targetOrigin` must be the preview's exact origin, never `'*'`. */
export function reportPreviewFocus(
  target: FocusReportTarget,
  field: string,
  targetOrigin: string,
): void {
  if (field.length === 0) return;
  const message: PreviewFocusMessage = { type: 'payload-live-preview-focus', field };
  target.postMessage(message, targetOrigin);
}

/** A reporter bound to a preview window and origin; `resolveTarget` runs per report, so a re-created iframe is addressed freshly. */
export function createPreviewFocusReporter(
  resolveTarget: () => FocusReportTarget | null | undefined,
  targetOrigin: string,
): (field: string) => void {
  return (field: string): void => {
    const target = resolveTarget();
    if (target === null || target === undefined) return;
    reportPreviewFocus(target, field, targetOrigin);
  };
}
