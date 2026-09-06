/**
 * An optional peer dependency, imported the first time it is actually needed.
 *
 * Every fragment binding renders with a component system this package does not
 * install: `astro`, `react`/`react-dom`, `svelte`, `vue`. A project that never
 * registers a fragment — most of them — must still be able to install and run
 * this package, so the import happens at the first render rather than at module
 * load, and always through a variable specifier so a bundler leaves it alone.
 */

/**
 * `load` runs once per process. Callers arriving while it is in flight share
 * that promise; a rejected one is forgotten rather than kept, so a project that
 * installs the package after the first request is not answered from the first
 * bad start for the rest of the process's life.
 */
export function lazyPeer<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending === undefined) {
      const started = load();
      pending = started;
      started.catch(() => {
        if (pending === started) pending = undefined;
      });
    }
    return pending;
  };
}

/**
 * The error a binding throws when its renderer's packages are not installed.
 * The endpoint answers 500 either way; this is what the server log says, and
 * without it the cause reads as "render failed".
 */
export function missingPeerError(packages: readonly string[], cause: unknown): Error {
  const names = packages.map((name) => `\`${name}\``).join(' and ');
  const one = packages.length === 1;
  return new Error(
    `payload-live-preview: this fragment endpoint renders with ${names}, ` +
      `${one ? 'an optional peer' : 'optional peers'} this package does not install. ` +
      `${one ? 'Install it' : 'Install them'}, or pass your own \`render\`.`,
    { cause },
  );
}
