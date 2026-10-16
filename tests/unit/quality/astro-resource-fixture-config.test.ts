/**
 * The resource fixture must remain a native, strict archive consumer.
 * These configuration contracts supplement computed-style browser assertions;
 * they never claim that compiling markup proves its CSS is present.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');
const source = (path: string): string => read(`tests/fixtures/astro-resources/${path}.fixture`);

describe('Astro resource consumer configuration', () => {
  it('pins the semantic checker independently of the existing host lock', () => {
    const manifest = JSON.parse(read('tests/fixtures/astro-resource-deps/package.json')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts['build']).toBe('npm run typecheck && astro build');
    expect(manifest.devDependencies['@astrojs/check']).toBe('0.9.10');
    expect(source('type-contracts/Negative.astro')).toContain('title.toFixed(2)');
    expect(read('tests/e2e/helpers/astro-resources.ts')).toContain(
      'negative Astro template control',
    );
  });

  it('keeps compiled assets outside the fragment and the sanitizer policy unchanged', () => {
    expect(source('astro.config.mjs')).toContain("inlineStylesheets: 'never'");
    const client = source('src/client/preview.ts');
    expect(client).toContain("from 'payload-live-preview/fragment'");
    expect(client).toContain('createFragmentStrategy(');
    expect(client).not.toContain('innerHTML');
    expect(client).not.toContain('sanitizerPolicy');
    expect(client).not.toContain('createElement');
    expect(source('src/middleware.ts')).toContain("style-src 'self'");
  });

  it('gets renderer context from current verified authority rather than posted locals', () => {
    const endpoint = source('src/pages/payload/resource-fragment.ts');
    expect(endpoint).toContain('active.host.page(target)');
    expect(endpoint).toContain('input.authorization.scope.path');
    expect(endpoint).toContain('input.authorization.scope.locale');
    expect(endpoint).toContain('new Request(new URL(path, active.origin)');
    expect(endpoint).not.toContain('locals: input.fields');
    expect(endpoint).not.toContain('headers: input.request.headers');
  });

  it('selects the bounded resource profile without changing the default Astro host', () => {
    const helper = read('tests/e2e/helpers/native-continuation.ts');
    expect(helper).toContain("profile: 'continuation' | 'astro-resources' = 'continuation'");
    expect(helper).toContain("profile === 'astro-resources'");
    expect(read('playwright.astro-resources.config.ts')).toContain(
      "testMatch: 'astro-resources.spec.ts'",
    );
  });
});
