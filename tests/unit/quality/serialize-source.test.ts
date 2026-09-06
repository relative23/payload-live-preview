import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeSource } from '../../../scripts/serialize-source';

/**
 * The runtime travels as a string literal inside a module a consumer's server
 * build bundles. Nitro's rollup replaces `typeof window` with `"undefined"`
 * everywhere in a bundle, string literals included — measured on a Nuxt
 * production build, where all six occurrences in the runtime came out
 * rewritten: every SSR guard inverted, and the bytes no longer the ones the
 * integrity hash was computed over.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERATED = [
  'runtime.generated.ts',
  'runtime-lean.generated.ts',
  'loader.generated.ts',
  'fragment.generated.ts',
  'route.generated.ts',
];
const TARGETS = ['typeof window', 'typeof document', 'process.env', 'import.meta'];

/** The value a bundler would read out of the emitted expression. */
function evaluate(expression: string): string {
  const literal = expression.replace(/^\/\* @__PURE__ \*\/ /u, '').replace(/\]\.join\(''\)$/u, ']');
  const parsed: unknown = JSON.parse(literal);
  return Array.isArray(parsed) ? (parsed as string[]).join('') : (parsed as string);
}

describe('serializing a generated source', () => {
  it('marks the join pure, because a bundler that cannot prove it keeps everything', () => {
    // Rolldown (Vite 8) would not drop an unproven call, so importing one pure
    // helper from the root barrel pulled in the whole package: 32 512 B gzip
    // against 220 under Rollup. The annotation costs 16 bytes.
    expect(serializeSource('typeof window')).toMatch(/^\/\* @__PURE__ \*\/ \[/u);
  });

  it('leaves a source without a rewritten token as one literal', () => {
    expect(serializeSource('const a = 1;')).toBe('"const a = 1;"');
  });

  it('splits inside the token, so no literal holds a whole one', () => {
    const source = 'if(typeof window>"u")return;';

    const serialized = serializeSource(source);

    expect(serialized).not.toContain('typeof window');
    expect(serialized).toBe('/* @__PURE__ */ ["if(typ","eof window>\\"u\\")return;"].join(\'\')');
    expect(evaluate(serialized)).toBe(source);
  });

  it('joins rather than adds, because both minifiers fold `+` back together', () => {
    // esbuild and terser evaluate `"a" + "b"` and re-emit one literal, which
    // would hand the token straight back to the next bundler. Neither
    // evaluates a method call.
    const serialized = serializeSource('typeof window; process.env.X; import.meta.url');

    expect(serialized).toContain(".join('')");
    for (const target of TARGETS.slice(0, 1).concat(['process.env', 'import.meta'])) {
      expect(serialized).not.toContain(target);
    }
    expect(evaluate(serialized)).toBe('typeof window; process.env.X; import.meta.url');
  });

  it.each(GENERATED)('%s carries no token a bundler would rewrite', (file) => {
    const source = readFileSync(resolve(ROOT, 'src/inline', file), 'utf8');

    for (const target of TARGETS) {
      expect(source, `${file} contains ${target}`).not.toContain(target);
    }
  });
});
