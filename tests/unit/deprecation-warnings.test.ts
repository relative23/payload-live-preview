import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { resolvePolicyOptions } from '@adapters/shared/policy-options';
import { generateInlineScript } from '@inline/generator';
import { resetDevWarnings } from '@/types/dev-warning';

/**
 * What a later release removes says so once per process while this one still
 * runs it, outside production only, and names what replaces it (ADR 0026).
 * What 3.0 removed is refused instead: `removed-options.test.ts` and the tests
 * of each module hold that.
 */
describe('what is still to be removed warns once in development (ADR 0026)', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    resetDevWarnings();
    vi.stubEnv('NODE_ENV', 'development');
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
    resetDevWarnings();
  });

  // The merge deadline 3.0 adds is a changed default, not a removal; its own
  // file holds it (three-zero-defaults.test.ts).
  function warnings(): string[] {
    return warn.mock.calls
      .map(([message]) => String(message))
      .filter((message) => !message.includes('`mergeTimeoutMs` is not set'));
  }

  it("defaults: 'v1' names the codemod that writes its rows out, from an adapter or the generator", () => {
    expect(resolvePolicyOptions({ defaults: 'v1' }).strict).toBe(false);
    expect(generateInlineScript({ defaults: 'v1' })).toContain('"v1"');
    resolvePolicyOptions({ defaults: 'v2' });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`defaults: 'v1'`.*removed in 3\.0.*`pll migrate`/u);
  });

  it('warns from the generator alone, for a page that calls it without an adapter', () => {
    generateInlineScript({ defaults: 'v1' });

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/`defaults: 'v1'`.*removed in 3\.0/u);
  });

  it('does not warn in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    resolvePolicyOptions({ defaults: 'v1' });
    generateInlineScript({ defaults: 'v1' });

    expect(warnings()).toEqual([]);
  });

  it('names each warning by a fixed key on the realm, which every copy of the package shares', () => {
    // Two copies in one process, possibly of different versions, must agree
    // on these strings, or each would print its own line.
    resolvePolicyOptions({ defaults: 'v1' });

    const issued = (globalThis as Record<string, unknown>)[
      '__payloadLivePreviewDeprecationsWarned'
    ];
    expect([...(issued as Set<string>)].sort()).toEqual(['defaults-v1', 'merge-deadline']);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
