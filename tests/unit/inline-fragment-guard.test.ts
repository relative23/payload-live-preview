import { describe, expect, it, vi } from 'vitest';

// Own file: the stub must be in place before the generator module is
// evaluated, and the other generator tests need the real prelude.
vi.mock('@inline/fragment.generated', () => ({ FRAGMENT_SOURCE: '' }));

describe('bundling without building the fragment prelude', () => {
  it('says which command is missing instead of emitting a page whose fragments never render', async () => {
    const { generateInlineScript, generateLoaderScript } = await import('@inline/generator');
    expect(() => generateInlineScript({ fragmentEndpoint: '/payload/fragment' })).toThrow(
      /build:runtime/u,
    );
    expect(() =>
      generateLoaderScript({ fragmentEndpoint: '/payload/fragment' }, { runtimeSrc: '/x.js' }),
    ).toThrow(/build:runtime/u);
    // A page without fragments never needs the prelude.
    expect(typeof generateInlineScript({})).toBe('string');
  });
});
