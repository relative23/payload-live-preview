/**
 * One development notice per page for a 2.x default that 3.0 changes. It is
 * the browser's counterpart to `warnOnce` (`src/types/dev-warning.ts`), which a
 * bundle cannot use because it has no `process.env`. `isDevMode()` decides, so
 * where `NODE_ENV` cannot be read only `localhost` hears it, as with the
 * Payload 2 notice (ADR 0026). The issued keys live on `globalThis`, so two
 * copies of the package on one page say a thing once.
 */

import { isDevMode } from './environment';

const ISSUED_KEY = '__payloadLivePreviewNotices';

/** Warn once per page for `key`, in development only. @internal */
export function noticeOnce(key: string, message: string): void {
  if (!isDevMode()) return;
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  const issued = (holder[ISSUED_KEY] ??= new Set<string>());
  if (issued.has(key)) return;
  issued.add(key);
  try {
    console.warn(`[payload-live-preview] ${message}`);
  } catch {
    // A console that throws must not break a preview.
  }
}

/** Test hook: forget every notice issued so far. @internal */
export function resetNotices(): void {
  (globalThis as unknown as Record<string, Set<string> | undefined>)[ISSUED_KEY] = undefined;
}
