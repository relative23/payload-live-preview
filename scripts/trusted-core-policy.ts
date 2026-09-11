/**
 * The reviewed shape of the trusted core: which modules it is, how many lines
 * they may total, what they import from outside, and which modules outside it
 * hold a capability anyway and why. `scripts/check-trusted-core.ts` measures
 * the core against it; `scripts/architecture-rules.ts` holds every module to
 * the capabilities written down here.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CapabilityKind } from './architecture-capabilities';

export const TRUSTED_CORE_POLICY_FILE = 'quality/trusted-core.json';

export interface ReviewedOutsider {
  readonly capabilities: readonly CapabilityKind[];
  readonly why: string;
}

export interface TrustedCorePolicy {
  readonly schemaVersion: number;
  readonly core: {
    /** Each core module with the capabilities it holds — exactly, so a new one fails until it is written down. */
    readonly modules: Readonly<Record<string, readonly CapabilityKind[]>>;
    /** The total, counted the way `wc -l` counts, with why it is what it is. */
    readonly lines: { readonly limit: number; readonly why: string };
    /** Runtime imports the core takes from outside itself, each with what a reader needs to know about it. */
    readonly dependencies: Readonly<Record<string, string>>;
  };
  /** Capabilities no module outside the core may hold, whatever the reason offered. */
  readonly coreOnly: readonly CapabilityKind[];
  /** Modules outside the core that hold a capability, with the reason each stays outside. */
  readonly outsideCore: Readonly<Record<string, ReviewedOutsider>>;
}

export async function readTrustedCorePolicy(repositoryRoot: string): Promise<TrustedCorePolicy> {
  return JSON.parse(
    await readFile(resolve(repositoryRoot, TRUSTED_CORE_POLICY_FILE), 'utf8'),
  ) as TrustedCorePolicy;
}
