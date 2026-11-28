/**
 * One development warning per process. The set of issued keys lives on
 * `globalThis` so two package copies in one process still warn once.
 */

const WARNED_KEY = '__payloadLivePreviewDeprecationsWarned';

/** `true` outside a production build; `false` when `NODE_ENV` is production or unknown. */
export function isDevelopmentProcess(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    if (env === undefined) return false;
    return env['NODE_ENV'] !== 'production';
  } catch {
    return false;
  }
}

/** Warn once per process for `key`, outside production only. */
export function warnOnce(key: string, message: string): void {
  if (!isDevelopmentProcess()) return;
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  const warned = (holder[WARNED_KEY] ??= new Set<string>());
  if (warned.has(key)) return;
  warned.add(key);
  try {
    console.warn(`[payload-live-preview] ${message}`);
  } catch {
    // A console that throws must not break a request.
  }
}

/** Test hook: forget every warning issued so far. */
export function resetDevWarnings(): void {
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  holder[WARNED_KEY] = undefined;
}
