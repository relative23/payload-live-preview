/**
 * Admin-side helper for "reveal the edited section" tier 2 (roadmap 2.0): report
 * which field the editor's cursor is in, so the preview scrolls to it even when
 * the user only moves the cursor (no typing). This runs in the Payload admin,
 * not in the preview page — wire it to a field component's focus/selection
 * events; the preview runtime listens for the message (`payload-live-preview-focus`)
 * and reveals the field.
 *
 * Framework-agnostic on purpose: it only needs the preview window and the field
 * name, so it drops into any admin (React, plain DOM) without a dependency.
 *
 * @module @client/preview-focus
 */

/** The preview window (usually `iframe.contentWindow`) messages are posted to. */
export interface FocusReportTarget {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/** The message the preview runtime recognises as a cursor-focus report. */
export interface PreviewFocusMessage {
  readonly type: 'payload-live-preview-focus';
  readonly field: string;
}

/**
 * Post one focus report to the preview window. `targetOrigin` must be the
 * preview's exact origin (never `'*'`) so the message cannot leak to another
 * document that happens to occupy the frame.
 */
export function reportPreviewFocus(
  target: FocusReportTarget,
  field: string,
  targetOrigin: string,
): void {
  if (field.length === 0) return;
  const message: PreviewFocusMessage = { type: 'payload-live-preview-focus', field };
  target.postMessage(message, targetOrigin);
}

/**
 * Build a reusable reporter bound to a preview window and origin. `resolveTarget`
 * is called per report so a lazily-created or re-created iframe is always
 * addressed freshly; a `null`/`undefined` target is a no-op (the preview is not
 * open yet). Wire the returned function to a field's `onFocus`/selection change,
 * passing that field's name.
 *
 * @example
 *   const report = createPreviewFocusReporter(
 *     () => document.querySelector('iframe.preview')?.contentWindow ?? null,
 *     'https://preview.example.com',
 *   );
 *   // in a Payload field component: onFocus={() => report(fieldName)}
 */
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
