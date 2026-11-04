/**
 * One development notice per page for a 2.x default that 3.0 changes, the
 * browser's counterpart to `warnOnce` (`src/types/dev-warning.ts`). The caller
 * decides when: it reads `process.env.NODE_ENV` in place, the expression a
 * bundler replaces, so a production build drops the call and its text
 * (ADR 0026). The issued keys live on `globalThis`, so two copies of the
 * package on one page say a thing once.
 */

const ISSUED_KEY = '__payloadLivePreviewNotices';

/**
 * `process.env` as a bundler sees it. `NODE_ENV` read with a dot is the
 * expression Vite (its dev server included), webpack and esbuild replace;
 * `@types/node` declares no `NODE_ENV`, and a bracket read is not replaced
 * everywhere. @internal
 */
export interface BundlerEnv {
  readonly NODE_ENV?: string;
}

/** Warn once per page for `key`; the caller has found development. @internal */
export function noticeOnce(key: string, message: string): void {
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
