import { describe, expect, it } from 'vitest';
import { resolvePolicyOptions, type PreviewPolicyOptions } from '@adapters/shared/policy-options';
import { generateInlineScript, generateLoaderScript } from '@inline/generator';
import type { InlineScriptConfig } from '@/types/inline-config';

/**
 * An option 3.0 removed has no place in the types, but a JavaScript config can still pass it.
 * The adapters and the generator refuse it at startup and name the codemod, in every mode:
 * ignoring it would run the page with other rows than the project asked for (ADR 0007).
 */
describe('an option 3.0 removed is refused, not ignored', () => {
  const target = { runtimeSrc: '/live-preview/runtime.js' };

  it('refuses `onUnboundChange` from an adapter, the generator and the loader (row 19)', () => {
    const refusal =
      'payload-live-preview: `onUnboundChange` was removed in 3.0. Name it `onUnfaithfulPatch`, ' +
      "where 'route' is 'escalate'; `pll migrate` renames it (ADR 0007, row 19).";
    const removed = { onUnboundChange: 'ignore' };

    expect(() => resolvePolicyOptions(removed as PreviewPolicyOptions)).toThrow(refusal);
    expect(() => generateInlineScript(removed as InlineScriptConfig)).toThrow(refusal);
    expect(() => generateLoaderScript(removed as InlineScriptConfig, target)).toThrow(refusal);
  });

  it('takes the option that replaced it', () => {
    expect(() => resolvePolicyOptions({ onUnfaithfulPatch: 'ignore' })).not.toThrow();
    expect(() => generateInlineScript({ onUnfaithfulPatch: 'ignore' })).not.toThrow();
  });
});
