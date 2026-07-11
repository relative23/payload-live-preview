/**
 * Single source of truth for the library version.
 *
 * Both the npm package surface (`src/index.ts`, `src/core-entry.ts`)
 * and the inline runtime (`src/core/runtime.ts`, which gets bundled by
 * esbuild and embedded into `runtime.generated.ts`) read the version
 * from here so they never drift.
 *
 * Imports `package.json` directly — tsc, tsup, and esbuild all inline
 * the value at build time when `resolveJsonModule` is enabled.
 *
 * @module @/version
 */

import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
