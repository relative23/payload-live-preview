/**
 * The historical Container floor needs an explicit application renderer.
 * These fixture contracts preserve the failing package-default probe and keep
 * request-local catalog data separate from browser-selected component code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { astroResourceRenderer } from '../../e2e/helpers/astro-resource-versions';

const source = (path: string): string =>
  readFileSync(`tests/fixtures/astro-resource-locals/${path}.fixture`, 'utf8');

describe('Astro request-local catalog fixture', () => {
  it('keeps the default floor reproduction distinct from a chosen recipe', () => {
    expect(astroResourceRenderer('4.9.0')).toBe('package-default');
    expect(astroResourceRenderer('7.3.2')).toBe('verified-context');
    expect(astroResourceRenderer('4.9.0', 'locals-catalog')).toBe('locals-catalog');
    expect(astroResourceRenderer('7.3.2', 'locals-catalog')).toBe('locals-catalog');
  });

  it.each(['4.9.0', '4.16.19', '5.18.2', '6.4.8', '7.3.2'])(
    'allows an explicit installed-default countercheck on %s',
    (version) => expect(astroResourceRenderer(version, 'package-default')).toBe('package-default'),
  );

  it.each(['', 'auto', '../local', '/tmp/renderer'])(
    'rejects an unreviewed renderer %j before installation',
    (renderer) =>
      expect(() => astroResourceRenderer('4.9.0', renderer)).toThrow(
        'Unreviewed Astro resource renderer',
      ),
  );

  it('refuses unreviewed versions even with a recognized recipe', () => {
    expect(() => astroResourceRenderer('4.0.0', 'locals-catalog')).toThrow(
      'Unreviewed Astro resource version',
    );
  });

  it('uses a statically imported, typed wrapper instead of private factories', () => {
    const wrapper = source('src/components/LocalCatalog.astro');
    expect(wrapper).toContain("import Blocks from './Blocks.astro'");
    expect(wrapper).toContain('Astro.locals.resourceCatalog');
    expect(wrapper).toContain('<Blocks {...catalog} />');
    expect(wrapper).toContain("throw new Error('Missing verified catalog')");
    expect(source('src/catalog-env.d.ts')).toContain('delayMs: 0 | 80');
    expect(wrapper).not.toContain('set:html');
  });

  it('validates the fixed component and fields before using public Container locals', () => {
    const endpoint = source('src/pages/payload/resource-fragment.ts');
    expect(endpoint).toContain('component !== Blocks');
    expect(endpoint).toContain("typeof show !== 'boolean'");
    expect(endpoint).toContain("typeof title !== 'string'");
    expect(endpoint).toContain('delayMs !== 0 && delayMs !== 80');
    expect(endpoint).toContain('resourceCatalog: { show, title, delayMs }');
    expect(endpoint).toContain('instance.renderToString(LocalCatalog,');
    expect(endpoint).not.toContain('astro/runtime');
    expect(endpoint).not.toContain('as unknown');
    expect(endpoint).not.toContain('locals: input.fields');
    expect(endpoint).not.toContain('headers: input.request.headers');
  });
});
