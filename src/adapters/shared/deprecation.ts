/**
 * One development warning per process for a deprecated name.
 *
 * ADR 0007 fixes the rule: a renamed export stays available for the rest of
 * 1.x, warns once — never in production — and names its replacement and the
 * ledger. The set of keys already warned lives on `globalThis` so two copies
 * of the package (a root import and an adapter import in the same process)
 * still warn once.
 *
 * @module @adapters/shared/deprecation
 */

const WARNED_KEY = '__payloadLivePreviewDeprecationsWarned';

/** `true` outside a production build, `false` when `NODE_ENV` says production or the environment cannot say. */
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

/**
 * Warn once per process, outside production only. Used for deprecations and
 * for insecure-default notices — the two things a developer should hear
 * exactly once and a production log should never carry.
 */
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

export function warnDeprecatedOnce(key: string, message: string): void {
  warnOnce(`deprecated:${key}`, message);
}

/** Test hook: forget every warning issued so far in this process. */
export function resetDeprecationWarnings(): void {
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  holder[WARNED_KEY] = undefined;
}
