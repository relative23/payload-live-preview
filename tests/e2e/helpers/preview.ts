import { expect, type Frame, type Page } from '@playwright/test';

/**
 * The harness every E2E fixture shares: an admin or bench page framing one
 * preview iframe tagged `data-testid="preview-frame"`, with a runtime handle on
 * the framed window. Only the handle name and the update's owner differ.
 */

const DEFAULT_TIMEOUT = 15_000;

/** `__lpClient` is the /client import's handle; adapters inject `__livePreview`. */
export type RuntimeHandle = '__livePreview' | '__lpClient';

export interface PostOptions {
  /** Sent as `globalSlug` so owner-scoped bindings accept the update. */
  readonly globalSlug?: string;
  /** Defaults to the admin window's own origin. */
  readonly targetOrigin?: string;
}

/** Hosts carry the framed path in their own query, so identity separates them, not the URL. */
export function previewFrame(page: Page, urlPart?: string): Frame | undefined {
  return page
    .frames()
    .find(
      (frame) =>
        frame !== page.mainFrame() && (urlPart === undefined || frame.url().includes(urlPart)),
    );
}

export function requirePreviewFrame(page: Page, urlPart?: string): Frame {
  const frame = previewFrame(page, urlPart);
  if (!frame) throw new Error('preview frame missing');
  return frame;
}

export async function waitForPreviewFrame(
  page: Page,
  urlPart?: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<Frame> {
  await expect.poll(() => previewFrame(page, urlPart) !== undefined, { timeout }).toBe(true);
  return requirePreviewFrame(page, urlPart);
}

/** Post one update into the preview the way the Admin would — parent to child. */
export async function post(
  page: Page,
  data: Record<string, unknown>,
  options: PostOptions = {},
): Promise<void> {
  await page.evaluate(
    ({ payload, globalSlug, targetOrigin }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (iframe?.contentWindow == null) throw new Error('preview frame is unavailable');
      const message: Record<string, unknown> = { type: 'payload-live-preview', data: payload };
      if (globalSlug !== undefined) message['globalSlug'] = globalSlug;
      iframe.contentWindow.postMessage(message, targetOrigin ?? window.location.origin);
    },
    { payload: data, globalSlug: options.globalSlug, targetOrigin: options.targetOrigin },
  );
}

export async function started(
  frame: Frame,
  handle: RuntimeHandle = '__livePreview',
): Promise<boolean> {
  return frame.evaluate((name) => {
    const api = (
      window as unknown as Record<
        string,
        { inspect: () => { started: boolean } } | null | undefined
      >
    )[name];
    return api?.inspect().started ?? false;
  }, handle);
}

export async function waitForStarted(
  frame: Frame,
  handle: RuntimeHandle = '__livePreview',
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await expect.poll(() => started(frame, handle), { timeout }).toBe(true);
}

/** Whether the reveal fixture's footer currently intersects the iframe viewport. */
export async function footerInView(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const element = document.querySelector('[data-testid="footer"]');
    if (element === null) return false;
    const rect = element.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  });
}
