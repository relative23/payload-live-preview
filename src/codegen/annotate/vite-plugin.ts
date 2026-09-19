/**
 * `livePreviewAnnotate()` — the annotator as a build step, so a template needs
 * no binding attributes written into it by hand.
 *
 * It rewrites the same shape `pll-codegen annotate` rewrites, decided by the
 * same scanner (`./scan`), into a call rather than a fixed attribute:
 *
 * ```astro
 * <h1>{page.title}</h1>
 * → <h1 {...__lpPreview.bind('title')}>{page.title}</h1>
 * ```
 *
 * The difference is who may see it. A fixed attribute is in the HTML of every
 * visitor and describes the content model to all of them; the call resolves per
 * request against the authorization the adapter published, so an unauthorized
 * response carries no `data-payload-*` at all (ADR 0006). A static build has no
 * request to resolve against and therefore emits nothing — `allowPublicBindings`
 * is how you say you want the attribute anyway, out loud.
 *
 * Astro only, for a reason rather than a lack of time: the rewrite needs a
 * template whose own scope can reach the request context, which frontmatter and
 * `Astro.locals` give and a Svelte or Vue component does not — there the value
 * would have to travel through `load` or a payload, where a function cannot go.
 *
 * Vite compatibility is a recorded fact, not a guess: `name`, `enforce` and
 * `load(id)` are the whole surface used here, and all three have been stable
 * since Vite 5. The majors that matter are in `quality/compat-matrix.json`,
 * which is what the tests read.
 *
 * `load` rather than `transform`, which is where a source rewrite would
 * normally go. Astro compiles `.astro` in a `transform` of its own, registered
 * `enforce: 'pre'` and ahead of anything a config contributes, so by the time
 * any user transform runs the markup is gone — measured, not assumed: a probe
 * plugin at `pre` received compiled output importing from Astro's own compiler
 * runtime, not the template. Every `load` runs before every `transform`, so
 * that is where the file is still a template. Reading it is what Rollup's
 * default loader would have done anyway.
 */

import { readFileSync } from 'node:fs';
import { annotatablePaths, type AnnotatableSchema } from './index';
import { applyAnnotations, fieldAttribute, scanTemplate, type AnnotationRefusal } from './scan';

/** The helper the rewritten markup calls, and the import that defines it. */
const HELPER = '__lpPreview';
const IMPORT_ALIAS = '__lpPreviewBindingsFromLocals';
const IMPORT_LINE = `import { previewBindingsFromLocals as ${IMPORT_ALIAS} } from 'payload-live-preview/server';`;
const HELPER_LINE = `const ${HELPER} = ${IMPORT_ALIAS}(Astro.locals);`;
const FENCE = '---';

/** @beta */
export interface AnnotatePluginOptions {
  /** The schema, from `generateTypes().inventory` or the `--inventory` file. */
  readonly inventory: AnnotatableSchema;
  /**
   * Write the plain `data-payload-field` attribute instead of the gated call.
   * A statically built site has no request to authorize, so this is the only
   * way it can carry bindings — and it publishes the field names to everyone.
   * Default `false`.
   */
  readonly allowPublicBindings?: boolean;
  /** Which modules to transform. Default: every `.astro` file. */
  readonly include?: (id: string) => boolean;
  /** Called once per file with what the scanner would not annotate. */
  readonly onRefusals?: (file: string, refusals: readonly AnnotationRefusal[]) => void;
  /** Reads a template. Defaults to the file system; injected by tests. */
  readonly readFile?: (path: string) => string;
}

/**
 * The slice of Vite's plugin shape this uses; three hooks, stable since Vite 5.
 *
 * @beta
 */
export interface AnnotateVitePlugin {
  readonly name: string;
  readonly enforce: 'pre';
  load(id: string): { code: string; map: null } | null;
}

/** Everything before the second `---`, and where the template starts. @internal */
export function splitFrontmatter(code: string): {
  readonly frontmatter: string;
  readonly bodyOffset: number;
} {
  if (!code.startsWith(FENCE)) return { frontmatter: '', bodyOffset: 0 };
  const end = code.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return { frontmatter: '', bodyOffset: 0 };
  const bodyOffset = end + 1 + FENCE.length;
  return { frontmatter: code.slice(FENCE.length, end), bodyOffset };
}

/** The frontmatter with the helper in it, whether or not the file had one. */
function withHelper(code: string, bodyOffset: number): string {
  const lines = `${IMPORT_LINE}\n${HELPER_LINE}\n`;
  if (bodyOffset === 0) return `${FENCE}\n${lines}${FENCE}\n${code}`;
  return `${FENCE}\n${lines}${code.slice(FENCE.length, bodyOffset)}${code.slice(bodyOffset)}`;
}

/**
 * A plain `.astro` path. Not a sub-request (`?astro&type=style`), not a virtual
 * module (`\0…`): those are Astro's own, and loading them is not this plugin's
 * business.
 */
const isAstro = (id: string): boolean =>
  !id.startsWith('\0') && !id.includes('?') && id.endsWith('.astro');

/**
 * The transform on its own, so a test can call it without a bundler and a
 * caller can see exactly what a file becomes.
 * @internal
 */
export function annotateSource(
  code: string,
  options: AnnotatePluginOptions,
): { readonly code: string; readonly refusals: readonly AnnotationRefusal[] } {
  const paths = annotatablePaths(options.inventory);
  const { bodyOffset } = splitFrontmatter(code);
  // Frontmatter is TypeScript, not markup: scanning it would match a template
  // written inside a string, and annotate something no browser ever sees.
  const body = code.slice(bodyOffset);
  const { candidates, refusals } = scanTemplate(body, { paths });
  if (candidates.length === 0) return { code, refusals };

  const shifted = candidates.map((candidate) => ({
    ...candidate,
    insertAt: candidate.insertAt + bodyOffset,
  }));
  const gated = options.allowPublicBindings !== true;
  const rewritten = applyAnnotations(code, shifted, (candidate) =>
    gated ? `{...${HELPER}.bind('${candidate.path}')}` : fieldAttribute(candidate),
  );
  return {
    code: gated ? withHelper(rewritten, bodyOffset) : rewritten,
    refusals,
  };
}

/**
 * ```js
 * // astro.config.mjs
 * vite: { plugins: [livePreviewAnnotate({ inventory })] }
 * ```
 *
 * @beta
 */
export function livePreviewAnnotate(options: AnnotatePluginOptions): AnnotateVitePlugin {
  const include = options.include ?? isAstro;
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  return {
    name: 'payload-live-preview:annotate',
    enforce: 'pre',
    load(id) {
      if (!include(id)) return null;
      const source = read(id);
      const { code, refusals } = annotateSource(source, options);
      if (refusals.length > 0) options.onRefusals?.(id, refusals);
      // The unannotated source is still returned: this loader replaces the
      // default one, so declining would leave the module empty.
      return { code, map: null };
    },
  };
}
