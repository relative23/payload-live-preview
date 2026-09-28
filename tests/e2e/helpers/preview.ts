import { expect, type Frame, type Page } from '@playwright/test';

/**
 * The harness every E2E fixture shares: an admin or bench page framing one
 * preview iframe tagged `data-testid="preview-frame"`, with a runtime handle on
 * the framed window. Only the handle name and the update's owner differ.
 */

const DEFAULT_TIMEOUT = 15_000;

/**
 * The Astro fixture's origin. `PLP_E2E_PORT` moves it off 4173 when another
 * project's server already answers there (playwright.config.ts); a spec that
 * spells the port out bypasses the override and runs against that server.
 */
export const ASTRO_ORIGIN = `http://localhost:${process.env['PLP_E2E_PORT'] ?? '4173'}`;
/** Next's development origin, or the HTTPS front door used by its production fixture. */
export const NEXT_ORIGIN = process.env['PLP_NEXT_ORIGIN'] ?? 'http://localhost:4174';

/** `__lpClient` is the /client import's handle; adapters inject `__livePreview`. */
export type RuntimeHandle = '__livePreview' | '__lpClient';

export interface PostOptions {
  /** Sent as `globalSlug` so owner-scoped bindings accept the update. */
  readonly globalSlug?: string;
  /** Defaults to the admin window's own origin. */
  readonly targetOrigin?: string;
  /**
   * Payload's panel puts `mostRecentUpdate` here, and after the first autosave
   * that is the edited document itself, in every message. A spec that wants the
   * runtime to re-render fields nobody changed asks for it through this.
   */
  readonly relationshipUpdate?: Record<string, unknown>;
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
    ({ payload, globalSlug, targetOrigin, relationshipUpdate }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (iframe?.contentWindow == null) throw new Error('preview frame is unavailable');
      const message: Record<string, unknown> = { type: 'payload-live-preview', data: payload };
      if (globalSlug !== undefined) message['globalSlug'] = globalSlug;
      if (relationshipUpdate !== undefined) {
        message['externallyUpdatedRelationship'] = relationshipUpdate;
      }
      iframe.contentWindow.postMessage(message, targetOrigin ?? window.location.origin);
    },
    {
      payload: data,
      globalSlug: options.globalSlug,
      targetOrigin: options.targetOrigin,
      relationshipUpdate: options.relationshipUpdate,
    },
  );
}

/**
 * Started and listening. `started` is set when `start()` is called; on a page
 * that declares hydration (ADR 0015) the runtime then still waits for React's
 * first commit before it attaches its listener, and a message posted in that
 * window is dropped — so a spec that posts right after this must wait for the
 * wait to end as well.
 */
export async function started(
  frame: Frame,
  handle: RuntimeHandle = '__livePreview',
): Promise<boolean> {
  return frame.evaluate((name) => {
    const api = (
      window as unknown as Record<
        string,
        { inspect: () => { started: boolean; hydration: { state: string } } } | null | undefined
      >
    )[name];
    if (api === null || api === undefined) return false;
    const snapshot = api.inspect();
    return snapshot.started && snapshot.hydration.state !== 'waiting';
  }, handle);
}

export async function waitForStarted(
  frame: Frame,
  handle: RuntimeHandle = '__livePreview',
  timeout = DEFAULT_TIMEOUT,
): Promise<void> {
  await expect.poll(() => started(frame, handle), { timeout }).toBe(true);
}

/** Accepted editor revisions, used to prove a navigation replay stayed local. */
export async function acceptedRevisions(frame: Frame): Promise<number> {
  return frame.evaluate(
    () =>
      (
        window as Window & {
          __livePreview?: { inspect: () => { revisions: { accepted: number } } };
        }
      ).__livePreview?.inspect().revisions.accepted ?? 0,
  );
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

/** Startup's handshake: one `ready` at start and three retries (`READY_RETRY_DELAYS_MS`). */
const STARTUP_READIES = 4;

type ReadyCountWindow = Window & { __plpReadies?: number };

/** Count every `ready` the preview sends the admin page from its first; call before `page.goto`. */
export async function countReadyHandshakes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    const counted = window as ReadyCountWindow;
    counted.__plpReadies = 0;
    window.addEventListener('message', (event) => {
      const message = event.data as { ready?: unknown; type?: unknown } | undefined;
      if (message?.type === 'payload-live-preview' && message.ready === true) {
        counted.__plpReadies = (counted.__plpReadies ?? 0) + 1;
      }
    });
  });
}

/**
 * Wait until startup sent its last `ready` retry, so a navigation probe
 * installed next counts only router handshakes. A fixed wait from the title's
 * visibility raced the runtime's own start in WebKit: the last retry fires
 * 2 000 ms after start, and start came up to 271 ms after the title (PHD-07).
 */
export async function waitForStartupReadies(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as ReadyCountWindow).__plpReadies ?? 0))
    .toBe(STARTUP_READIES);
}

interface NavigationProbe {
  events: number;
  ready: number;
  readonly documents: unknown[];
  /** Every bound-title value observed while a router replaces and the runtime reapplies it. */
  readonly titles: string[];
}

type NavigationProbeWindow = Window & { __plpNavigationProbe?: NavigationProbe };

/** Observe commits, admin documents and the published-to-unsaved DOM transition. */
export async function installNavigationProbe(page: Page): Promise<void> {
  await page.evaluate(
    ({ documentEventName, navigationEventName }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      const child = iframe?.contentWindow;
      if (child === null || child === undefined) throw new Error('preview frame is unavailable');

      const titleSelector = '[data-payload-field="title"]';
      const probe: NavigationProbe = { events: 0, ready: 0, documents: [], titles: [] };
      (window as NavigationProbeWindow).__plpNavigationProbe = probe;
      const remember = (value: string | null): void => {
        if (value !== null && value.length > 0) probe.titles.push(value);
      };
      const rememberBoundNode = (node: Node): void => {
        if (node.nodeType === 3) {
          const parent = node.parentElement;
          if (parent?.closest(titleSelector) !== null) remember(node.textContent);
          return;
        }
        if (node.nodeType !== 1) return;
        const element = node as Element;
        if (element.matches(titleSelector)) remember(element.textContent);
        for (const match of element.querySelectorAll(titleSelector)) remember(match.textContent);
      };
      remember(child.document.querySelector(titleSelector)?.textContent ?? null);
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') {
            const parent = record.target.parentElement;
            if (parent?.closest(titleSelector) !== null) {
              remember(record.oldValue);
              remember(record.target.textContent);
            }
            continue;
          }
          for (const node of record.removedNodes) rememberBoundNode(node);
          for (const node of record.addedNodes) rememberBoundNode(node);
        }
        remember(child.document.querySelector(titleSelector)?.textContent ?? null);
      }).observe(child.document, {
        subtree: true,
        childList: true,
        characterData: true,
        characterDataOldValue: true,
      });
      window.addEventListener('message', (event) => {
        const message = event.data as { ready?: unknown; type?: unknown } | undefined;
        if (message?.type === 'payload-live-preview' && message.ready === true) probe.ready += 1;
      });
      child.document.addEventListener(navigationEventName, () => {
        probe.events += 1;
      });
      document.addEventListener(documentEventName, (event) => {
        probe.documents.push(structuredClone((event as CustomEvent<unknown>).detail));
      });
    },
    {
      documentEventName: 'payload-live-preview:fixture-document',
      navigationEventName: 'payload-live-preview:navigation',
    },
  );
}

/** A clone keeps later admin sends from mutating an assertion's baseline. */
export async function readNavigationProbe(page: Page): Promise<NavigationProbe> {
  return page.evaluate(() => {
    const probe = (window as NavigationProbeWindow).__plpNavigationProbe;
    if (probe === undefined) throw new Error('navigation probe is not installed');
    return structuredClone(probe);
  });
}
