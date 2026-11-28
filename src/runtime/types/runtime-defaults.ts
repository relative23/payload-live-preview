/**
 * The runtime's half of the defaults table, one export per option; the table as a whole is
 * described in `defaults-profile.ts`. It is a module and not an object so that a bundle carries
 * the rows it reads and no others: a hook reads three, the runtime all of them. Read it as a
 * namespace, `import * as V2_RUNTIME_DEFAULTS`, which a bundler resolves row by row.
 */

import type { EventSourcePolicy } from './defaults-profile';

/** The deadline of a merge request; a hook spells the option `timeoutMs`. `0` is none. */
export const mergeTimeoutMs = 10_000;
export const debounceMs = 50;
export const heartbeatMs = 0;
export const enableA11y = true;
export const enableVisibilityGate = true;
export const visibilityGateThreshold = 50;
export const intersectionRootMargin = '200px';
export const enableReferrerDetection = false;
export const enableLocalhostMatching = true;
export const eventSourcePolicy: EventSourcePolicy = 'parent-or-opener';
export const skipUnchanged = true;
export const sanitizerPolicy: 'compat' | 'strict' = 'strict';
export const scopeBindingsByOwner = false;
export const revealEditedField = false;
export const onUnfaithfulPatch: 'ignore' | 'warn' | 'escalate' = 'escalate';
export const autoBind: 'off' | 'unique' = 'off';
export const subfieldCoverage: 'descendant' | 'declared' = 'declared';
