import { describe, expect, it } from 'vitest';
import { createPreviewPolicy } from '@adapters/shared/policy';
import { resolvePolicyOptions, type PreviewPolicyOptions } from '@adapters/shared/policy-options';
import { withProfileDefaults, type LivePreviewClientConfig } from '@client/config';
import { generateInlineScript, generateLoaderScript } from '@inline/generator';
import type { InlineScriptConfig } from '@/types/inline-config';

/**
 * An option 3.0 removed has no place in the types, but a JavaScript config can still pass it.
 * The adapters, the generator and the client refuse it at startup and name the way out, in
 * every mode: ignoring it would run the page with other rows than the project asked for
 * (ADR 0007).
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

  it("refuses `defaults: 'v1'` from an adapter, the generator, the loader and the client (row 21)", () => {
    const refusal =
      "payload-live-preview: `defaults: 'v1'` was removed in 3.0. `pll migrate` writes the 1.x " +
      "rows it stood for into your options. Two cannot be kept: `strict: false` and 'referer' " +
      'among the preview signals (ADR 0007, row 21).';
    const removed = { defaults: 'v1' };

    expect(() => resolvePolicyOptions(removed as PreviewPolicyOptions)).toThrow(refusal);
    expect(() => generateInlineScript(removed as InlineScriptConfig)).toThrow(refusal);
    expect(() => generateLoaderScript(removed as InlineScriptConfig, target)).toThrow(refusal);
    expect(() => withProfileDefaults(removed as LivePreviewClientConfig)).toThrow(refusal);
  });

  it('refuses `strict: false` from an adapter, and before the rule it used to switch off (row 36)', () => {
    const refusal =
      'payload-live-preview: `strict: false` was removed in 3.0; remove the option. An adapter ' +
      'that changes a response for a request needs `authorizePreview`, a hook that returns ' +
      '`authorizePreviewRequest(request, strategy)` (docs/authorization.md; ADR 0007, row 36).';
    const removed = { strict: false, allowedOrigins: ['https://admin.example.com'] };

    expect(() => resolvePolicyOptions(removed as PreviewPolicyOptions)).toThrow(refusal);
    // No hook either: the policy names the removed option, not the hook it would ask for next.
    expect(() => createPreviewPolicy(removed as PreviewPolicyOptions)).toThrow(refusal);
  });

  it('takes what replaced them, and the names that stayed', () => {
    expect(() => resolvePolicyOptions({ onUnfaithfulPatch: 'ignore' })).not.toThrow();
    expect(() => generateInlineScript({ onUnfaithfulPatch: 'ignore' })).not.toThrow();
    expect(() => resolvePolicyOptions({ defaults: 'v2', strict: true })).not.toThrow();
    expect(() => withProfileDefaults({ defaults: 'v2' })).not.toThrow();
  });
});
