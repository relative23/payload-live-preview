/**
 * A checkout that bundles before `npm run build:runtime` has empty generated
 * sources. The generator names the one that is missing and the command that
 * writes it, rather than handing a page a script with no runtime in it. Each
 * case empties one module, so the guard ahead of it has run and passed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEAN_RUNTIME } from '@/lean';

async function generatorWithout(module: string, name: string) {
  vi.resetModules();
  vi.doMock(module, async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    [name]: '',
  }));
  return import('@inline/generator');
}

const unbuilt = (artifact: string): Error =>
  new Error(`[live-preview] ${artifact} is empty. Run \`npm run build:runtime\` before bundling.`);

afterEach(() => {
  vi.doUnmock('@inline/runtime.generated');
  vi.doUnmock('@inline/fragment.generated');
  vi.doUnmock('@inline/route.generated');
  vi.doUnmock('@inline/loader.generated');
  vi.doUnmock('@inline/loader-react.generated');
});

describe('a generator whose sources were never built', () => {
  it('names the runtime', async () => {
    const { generateInlineScript } = await generatorWithout(
      '@inline/runtime.generated',
      'RUNTIME_SOURCE',
    );
    expect(() => generateInlineScript()).toThrow(unbuilt('runtime.generated.ts'));
  });

  it('names the fragment prelude', async () => {
    const { generateInlineScript } = await generatorWithout(
      '@inline/fragment.generated',
      'FRAGMENT_SOURCE',
    );
    expect(() => generateInlineScript({ fragmentEndpoint: '/payload/fragment' })).toThrow(
      unbuilt('fragment.generated.ts'),
    );
  });

  it('names the route prelude', async () => {
    const { generateInlineScript } = await generatorWithout(
      '@inline/route.generated',
      'ROUTE_SOURCE',
    );
    expect(() => generateInlineScript({ routeStrategy: true })).toThrow(
      unbuilt('route.generated.ts'),
    );
  });

  it('names the loader, and the one armed for React', async () => {
    const target = { runtimeSrc: '/_lp/runtime.js' };
    const plain = await generatorWithout('@inline/loader.generated', 'LOADER_SOURCE');
    expect(() => plain.generateLoaderScript({}, target)).toThrow(unbuilt('loader.generated.ts'));
    const react = await generatorWithout('@inline/loader-react.generated', 'LOADER_REACT_SOURCE');
    expect(() => react.generateLoaderScript({ hydration: 'react' }, target)).toThrow(
      unbuilt('loader-react.generated.ts'),
    );
  });

  it('names an imported runtime artifact by its profile', async () => {
    const { generateInlineScript } = await import('@inline/generator');
    expect(() => generateInlineScript({ runtime: { ...LEAN_RUNTIME, source: '' } })).toThrow(
      unbuilt('the lean runtime'),
    );
  });
});
