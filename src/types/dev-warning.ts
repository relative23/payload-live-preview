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

/**
 * The deprecated options the adapters and the inline generator both accept;
 * an adapter hands them on to the generator, and the shared keys keep that to
 * one warning each (ADR 0026).
 */
export function warnDeprecatedOptions(options: {
  readonly defaults?: string | undefined;
  readonly onUnboundChange?: string | undefined;
}): void {
  if (options.defaults === 'v1') {
    warnOnce(
      'defaults-v1',
      "`defaults: 'v1'` is removed in 3.0: `pll migrate` writes the 1.x rows it stands for " +
        'into your options, where they keep working (ADR 0026).',
    );
  }
  if (options.onUnboundChange !== undefined) {
    warnOnce(
      'on-unbound-change',
      "`onUnboundChange` is removed in 3.0: name it `onUnfaithfulPatch`, where 'route' is " +
        "'escalate'; `pll migrate` renames it (ADR 0026).",
    );
  }
}

/** Test hook: forget every warning issued so far. */
export function resetDevWarnings(): void {
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  holder[WARNED_KEY] = undefined;
}
