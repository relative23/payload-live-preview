import { observeThenableResult } from './thenable';

/**
 * Consumer diagnostics are best-effort observability, never control flow.
 *
 * Logger callbacks are arbitrary application code: they may throw, return a
 * rejected Promise, or expose a hostile thenable. This wrapper contains every
 * one of those outcomes while keeping invocation synchronous for ordinary
 * loggers. Callers can therefore report a failure without weakening the
 * lifecycle, merge-fallback, renderer, or teardown guarantee being reported.
 */
export function isolateDiagnostic(
  diagnostic: (...args: unknown[]) => unknown,
): (...args: unknown[]) => void {
  return (...args): void => {
    try {
      observeThenableResult(diagnostic(...args));
    } catch {
      // Diagnostics must not become a second failure boundary.
    }
  };
}

/** Shared allocation-free default for disabled diagnostic channels. */
export function noopDiagnostic(): void {
  // Intentionally empty.
}

// Property access, invocation, and thenable inspection all happen inside the
// wrapper, so missing/hostile console implementations cannot escape.
export const safeConsoleError = isolateDiagnostic((...args) =>
  (console.error as (...values: unknown[]) => unknown)(...args),
);

export const safeConsoleWarn = isolateDiagnostic((...args) =>
  (console.warn as (...values: unknown[]) => unknown)(...args),
);

export const safeConsoleDebug = isolateDiagnostic((...args) =>
  // eslint-disable-next-line no-console -- best-effort development diagnostics
  (console.debug as (...values: unknown[]) => unknown)(...args),
);
