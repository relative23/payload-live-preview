/**
 * How a generated source constant is written into TypeScript.
 *
 * Its own module because it is the answer to a specific, measured failure and
 * carries its own test; `build-runtime.ts` runs a build on import.
 */

/**
 * Tokens a consumer's bundler rewrites anywhere in a module — string literals
 * included. Nitro is the one this was measured on: `@rollup/plugin-replace`
 * with `'typeof window': '"undefined"'` and no respect for what is code and
 * what is data (nitropack/dist/rollup/index.mjs). A Nuxt production build of
 * the runtime string came out with all six occurrences rewritten, which
 * inverts every SSR guard in it and changes bytes an integrity hash was
 * computed over.
 */
const BUNDLER_REWRITES =
  /typeof (?:window|document|self|process)|process\.env|import\.meta|globalThis\.process/gu;

/**
 * The source as a TypeScript expression, split so no rewritten token survives
 * whole in any one literal. `.join('')` rather than `+`: esbuild and terser
 * both fold `"a" + "b"` back into one literal, and neither evaluates the call.
 * The value is identical, at the cost of a few bytes and one join per import.
 */
export function serializeSource(source: string): string {
  const chunks: string[] = [];
  let last = 0;
  for (const match of source.matchAll(BUNDLER_REWRITES)) {
    // Three characters in: enough that neither side holds a whole token.
    const cut = match.index + 3;
    chunks.push(source.slice(last, cut));
    last = cut;
  }
  if (chunks.length === 0) return JSON.stringify(source);
  chunks.push(source.slice(last));
  return `/* @__PURE__ */ [${chunks.map((chunk) => JSON.stringify(chunk)).join(',')}].join('')`;
}
