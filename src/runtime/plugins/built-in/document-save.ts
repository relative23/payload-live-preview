/**
 * `documentSave` plugin: what to do when Payload saves the document.
 * `'silent'` (default) emits only; `'reload'` reloads and restores the scroll
 * position; `'revalidate'` POSTs to a revalidation endpoint; `'fetch'` runs
 * a custom handler.
 */

import type { LivePreviewPlugin } from '../types';

const SCROLL_KEY = 'payload-live-preview:scroll';

function saveScrollPosition(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      SCROLL_KEY,
      JSON.stringify({ href: window.location.href, x: window.scrollX, y: window.scrollY }),
    );
  } catch {
    // sessionStorage is unavailable in a sandboxed iframe without allow-same-origin.
  }
}

function restoreScrollPosition(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(SCROLL_KEY);
    const saved = JSON.parse(raw) as { href?: string; x?: number; y?: number };
    if (saved.href !== window.location.href) return;
    window.scrollTo(saved.x ?? 0, saved.y ?? 0);
  } catch {
    // A corrupt entry or unavailable storage: nothing to restore.
  }
}

function reloadPreservingScroll(): void {
  if (typeof window === 'undefined') return;
  saveScrollPosition();
  window.location.reload();
}

export type DocumentSaveStrategy = 'silent' | 'reload' | 'revalidate' | 'fetch';

/** Handler for the `fetch` strategy; the signal aborts when the plugin is removed. */
export type DocumentSaveHandler = {
  bivarianceHack(signal?: AbortSignal): void | Promise<void>;
}['bivarianceHack'];

export interface DocumentSavePluginOptions {
  /** Default `'silent'`. */
  readonly strategy?: DocumentSaveStrategy;
  /**
   * `'revalidate'` endpoint, default `/api/revalidate`; the body is
   * `{ source: 'payload-live-preview' }`. The request is a plain `fetch` from
   * the preview page: cookies travel with it, there is no CSRF token, and a
   * bearer secret in `revalidateHeaders` would sit in page JavaScript. The
   * endpoint must authorise on its own (session cookie, same-origin check).
   */
  readonly revalidateUrl?: string;
  /** Extra request headers for `'revalidate'`; `Content-Type` is set already. */
  readonly revalidateHeaders?: Readonly<Record<string, string>>;
  /** `'fetch'` handler; rejections are logged, never thrown. */
  readonly handler?: DocumentSaveHandler;
  /** `'reload'` hard-refreshes when the revalidate request fails or returns non-2xx. */
  readonly onRevalidateFailure?: 'silent' | 'reload';
}

const DEFAULT_REVALIDATE_URL = '/api/revalidate';

export function documentSavePlugin(options: DocumentSavePluginOptions = {}): LivePreviewPlugin {
  const strategy = options.strategy ?? 'silent';
  return {
    name: 'document-save',
    version: '1.1.0',
    init: (ctx) => {
      let active = true;
      const controllers = new Set<AbortController>();
      ctx.registerCleanup?.(() => {
        active = false;
        for (const controller of controllers) controller.abort();
        controllers.clear();
      });
      restoreScrollPosition();
      ctx.events.on('documentSave', () => {
        if (!active) return;
        if (strategy === 'silent') return;
        if (strategy === 'reload') {
          reloadPreservingScroll();
          return;
        }
        const controller = new AbortController();
        controllers.add(controller);
        const operation =
          strategy === 'fetch'
            ? runFetch(options, ctx.log, controller.signal, () => active)
            : runRevalidate(options, ctx.log, controller.signal, () => active);
        void operation.finally(() => {
          controllers.delete(controller);
        });
      });
    },
  };
}

async function runFetch(
  options: DocumentSavePluginOptions,
  log: (...args: unknown[]) => void,
  signal: AbortSignal,
  isActive: () => boolean,
): Promise<void> {
  if (!options.handler) {
    log('document-save: fetch strategy selected but no handler supplied');
    return;
  }
  try {
    await options.handler(signal);
  } catch (err) {
    if (!isActive() || signal.aborted) return;
    log('document-save handler threw:', err);
  }
}

async function runRevalidate(
  options: DocumentSavePluginOptions,
  log: (...args: unknown[]) => void,
  signal: AbortSignal,
  isActive: () => boolean,
): Promise<void> {
  if (typeof fetch === 'undefined') {
    log('document-save: revalidate strategy needs fetch — not available');
    return;
  }
  const url = options.revalidateUrl ?? DEFAULT_REVALIDATE_URL;
  let ok = false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.revalidateHeaders ?? {}),
      },
      body: JSON.stringify({ source: 'payload-live-preview' }),
    });
    if (!isActive() || signal.aborted) return;
    ok = response.ok;
    if (!ok) log('document-save revalidate non-2xx:', response.status);
  } catch (err) {
    if (!isActive() || signal.aborted) return;
    log('document-save revalidate failed:', err);
  }
  if (!ok && options.onRevalidateFailure === 'reload') {
    reloadPreservingScroll();
  }
}
