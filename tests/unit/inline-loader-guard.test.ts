import { describe, expect, it, vi } from 'vitest';

// Own file: the stub has to be in place before the generator module is
// evaluated, and the other loader tests need the real artifact.
vi.mock('@inline/loader.generated', () => ({ LOADER_SOURCE: '' }));

describe('bundling without building the loader', () => {
  it('says which command is missing instead of emitting a script that does nothing', async () => {
    // Silent success here would ship a page whose bootstrap is an empty string:
    // no error, no runtime, and nothing to point at.
    const { generateLoaderScript } = await import('@inline/generator');
    expect(() => generateLoaderScript({}, { runtimeSrc: '/x.js' })).toThrow(/build:runtime/u);
  });
});
