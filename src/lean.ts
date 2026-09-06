/**
 * The lean runtime as a value.
 *
 * Importing this entry is what puts the second artifact in your build — about
 * 24 KB gzip of embedded script — so a project that never uses it pays nothing.
 * That is why it is an import rather than a `profile: 'lean'` string: measured
 * on this package, a string option put the artifact into every adapter entry
 * and grew each by the same 24 KB.
 *
 * ```ts
 * import { LEAN_RUNTIME } from 'payload-live-preview/lean';
 *
 * livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
 * ```
 *
 * What it leaves out, and what a page is told when it needs one of those:
 * docs/options.md and LP0104 in docs/troubleshooting.md.
 */

import { RUNTIME_LEAN_SOURCE } from './inline/runtime-lean.generated';
import type { RuntimeArtifact } from './types/inline-config';

export type { RuntimeArtifact } from './types/inline-config';

/** The lean build: no strategies, no keyed morph, no structural arrays, no item templates, no announcer. */
export const LEAN_RUNTIME: RuntimeArtifact = Object.freeze({
  profile: 'lean',
  source: RUNTIME_LEAN_SOURCE,
});
