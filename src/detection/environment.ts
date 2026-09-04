/**
 * Where the runtime is running: framed, opened, or on a developer's machine.
 * Nothing reads bundler-injected variables; a Vite consumer passes
 * `import.meta.env.X` explicitly (docs/astro.md).
 */

export function isInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent throws on the comparison; that is an iframe.
    return true;
  }
}

export function isInPopup(): boolean {
  if (typeof window === 'undefined') return false;
  return window.opener != null;
}

/** An iframe or a popup; top-level navigation never starts the preview. */
export function isInPreviewContext(): boolean {
  return isInIframe() || isInPopup();
}

/** Under Node, `NODE_ENV !== 'production'`; in a browser the hostname, which is the only signal a bundle has. */
export function isDevMode(): boolean {
  const nodeEnv = readNodeEnv();
  if (nodeEnv !== undefined) return nodeEnv !== 'production';
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }
  return false;
}

function readNodeEnv(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const value = process.env['NODE_ENV'];
  return typeof value === 'string' ? value : undefined;
}
