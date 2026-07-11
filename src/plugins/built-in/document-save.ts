/**
 * `documentSave` plugin — react to Payload document-save events with
 * out-of-the-box strategies. Most consumers just want one of these:
 *
 *   - `'silent'` (default) → only emit the event, do nothing else.
 *   - `'reload'`           → call `window.location.reload()`.
 *   - `'revalidate'`       → POST to a revalidation endpoint (Astro,
 *                            Next.js convention) so SSR caches refresh
 *                            without losing client state.
 *   - `'fetch'`            → custom async handler supplied by the user.
 *
 * Each strategy is intentionally narrow so consumers can compose them
 * — e.g. revalidate, then if revalidation fails, fall back to reload.
 *
 * @module @plugins/built-in/document-save
 */

import type { LivePreviewPlugin } from '../types';

export type DocumentSaveStrategy = 'silent' | 'reload' | 'revalidate' | 'fetch';

export interface DocumentSavePluginOptions {
  /** Strategy to invoke on each `documentSave` event. Default `'silent'`. */
  readonly strategy?: DocumentSaveStrategy;
  /**
   * For `'revalidate'`: endpoint to POST to. Defaults to `/api/revalidate`.
   * The request body is `{ source: 'payload-live-preview' }` JSON.
   */
  readonly revalidateUrl?: string;
  /**
   * For `'revalidate'`: extra headers (e.g., `Authorization: Bearer …`).
   * The `Content-Type: application/json` header is set automatically.
   */
  readonly revalidateHeaders?: Readonly<Record<string, string>>;
  /**
   * For `'fetch'`: async handler called on each event. The plugin
   * awaits it; rejections are logged but don't crash the runtime.
   */
  readonly handler?: () => void | Promise<void>;
  /**
   * Optional fallback strategy when `'revalidate'` POST fails (network
   * error or non-2xx). Set to `'reload'` to hard-refresh the page when
   * SSR-cache invalidation can't be confirmed.
   */
  readonly onRevalidateFailure?: 'silent' | 'reload';
}

const DEFAULT_REVALIDATE_URL = '/api/revalidate';

/**
 * Build the plugin. Pass it to `client.use(documentSavePlugin({ … }))`.
 */
export function documentSavePlugin(
  options: DocumentSavePluginOptions = {},
): LivePreviewPlugin {
  const strategy = options.strategy ?? 'silent';
  return {
    name: 'document-save',
    version: '1.0.0',
    init: (ctx) => {
      ctx.events.on('documentSave', () => {
        run(strategy, options, ctx.log);
      });
    },
  };
}

function run(
  strategy: DocumentSaveStrategy,
  options: DocumentSavePluginOptions,
  log: (...args: unknown[]) => void,
): void {
  if (strategy === 'silent') return;
  if (strategy === 'reload') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  if (strategy === 'fetch') {
    void runFetch(options, log);
    return;
  }
  void runRevalidate(options, log);
}

async function runFetch(
  options: DocumentSavePluginOptions,
  log: (...args: unknown[]) => void,
): Promise<void> {
  if (!options.handler) {
    log('document-save: fetch strategy selected but no handler supplied');
    return;
  }
  try {
    await options.handler();
  } catch (err) {
    log('document-save handler threw:', err);
  }
}

async function runRevalidate(
  options: DocumentSavePluginOptions,
  log: (...args: unknown[]) => void,
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
      headers: {
        'Content-Type': 'application/json',
        ...(options.revalidateHeaders ?? {}),
      },
      body: JSON.stringify({ source: 'payload-live-preview' }),
    });
    ok = response.ok;
    if (!ok) log('document-save revalidate non-2xx:', response.status);
  } catch (err) {
    log('document-save revalidate failed:', err);
  }
  if (!ok && options.onRevalidateFailure === 'reload') {
    if (typeof window !== 'undefined') window.location.reload();
  }
}
