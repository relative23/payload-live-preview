import { observeThenableResult } from './thenable';

/**
 * Diagnostics are observability, never control flow: a consumer logger may
 * throw or return a rejected thenable, and reporting a failure must not become
 * a second failure. Invocation stays synchronous for ordinary loggers.
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

// Access, invocation and thenable inspection all happen inside the wrapper, so
// a missing or hostile console cannot escape.
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
