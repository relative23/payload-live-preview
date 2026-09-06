import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  annotateSource,
  livePreviewAnnotate,
  splitFrontmatter,
  type AnnotatePluginOptions,
} from '@/codegen/annotate/vite-plugin';
import { majorsIn } from '../../../scripts/compat-vite';
import type { PreviewInventory } from '@/codegen/inventory';

/**
 * The annotator as a build step. What it may annotate is the scanner's
 * decision and is tested with the scanner; what is tested here is the rewrite:
 * a call bound to the request's authorization rather than an attribute every
 * visitor receives.
 */

const inventory: PreviewInventory = {
  globals: [
    {
      slug: 'home',
      typeName: 'Home',
      fields: [
        { path: 'title', kind: 'scalar', localized: false, required: true },
        { path: 'hero.eyebrow', kind: 'scalar', localized: false, required: false },
        { path: 'slides.*.caption', kind: 'scalar', localized: false, required: false },
      ],
    },
  ],
  collections: [],
};
const options: AnnotatePluginOptions = { inventory };

const PAGE = `---
const page = { title: 'x', hero: { eyebrow: 'y' } };
---
<h1>{page.title}</h1>
<p>{page.hero.eyebrow}</p>
`;

describe('rewriting a template', () => {
  it('binds through the request-scoped helper, not through an attribute', () => {
    const { code } = annotateSource(PAGE, options);

    expect(code).toContain("<h1 {...__lpPreview.bind('title')}>");
    expect(code).toContain("<p {...__lpPreview.bind('hero.eyebrow')}>");
    expect(code).not.toContain('data-payload-field');
  });

  it('builds the helper once per file, from the locals the adapter published', () => {
    const { code } = annotateSource(PAGE, options);

    expect(code.split('__lpPreviewBindingsFromLocals(Astro.locals)')).toHaveLength(2);
    expect(code).toContain("from 'payload-live-preview/server'");
    // The file's own frontmatter is kept, and kept after the helper.
    expect(code).toContain("const page = { title: 'x'");
  });

  it('gives a file without frontmatter one', () => {
    const { code } = annotateSource('<h1>{page.title}</h1>\n', options);

    expect(code.startsWith('---\n')).toBe(true);
    expect(code).toContain("<h1 {...__lpPreview.bind('title')}>");
  });

  it('writes the plain attribute only when asked, out loud', () => {
    const { code } = annotateSource(PAGE, { ...options, allowPublicBindings: true });

    expect(code).toContain('<h1 data-payload-field="title">');
    // No helper: nothing resolves per request, which is the point of the flag.
    expect(code).not.toContain('__lpPreview');
  });

  it('leaves a file the scanner refuses untouched, and says why', () => {
    const source = `---\n---\n<h1>Hello {page.title}</h1>\n<p>{page.missing}</p>\n`;

    const { code, refusals } = annotateSource(source, options);

    expect(code).toBe(source);
    expect(refusals.map((refusal) => refusal.reason)).toEqual([
      expect.stringContaining('printed beside other content'),
      expect.stringContaining('no field `missing`'),
    ]);
  });

  it('never annotates markup written inside frontmatter', () => {
    // Frontmatter is TypeScript. A template in a string is not the document.
    const source = `---\nconst sample = '<h1>{page.title}</h1>';\n---\n<p>{page.title}</p>\n`;

    const { code } = annotateSource(source, options);

    expect(code).toContain("const sample = '<h1>{page.title}</h1>';");
    expect(code).toContain("<p {...__lpPreview.bind('title')}>");
  });

  it('splits the frontmatter fence, or reports there is none', () => {
    expect(splitFrontmatter(PAGE).frontmatter).toContain('const page');
    expect(splitFrontmatter('<h1>x</h1>')).toEqual({ frontmatter: '', bodyOffset: 0 });
    // An unterminated fence is not frontmatter; treating it as one would cut
    // the file in half.
    expect(splitFrontmatter('---\nconst a = 1;\n')).toEqual({ frontmatter: '', bodyOffset: 0 });
  });
});

describe('the plugin around it', () => {
  const load = (id: string, file = PAGE): { code: string } | null =>
    livePreviewAnnotate({ ...options, readFile: () => file }).load(id);

  it('loads `.astro` and nothing else', () => {
    expect(load('/src/pages/index.astro')?.code).toContain('__lpPreview');
    expect(load('/src/lib/thing.ts')).toBeNull();
    expect(load('/src/lib/Thing.svelte')).toBeNull();
    // Astro's own sub-requests and virtual modules are its business.
    expect(load('/src/pages/index.astro?astro&type=style')).toBeNull();
    expect(load('\0virtual:astro:page')).toBeNull();
  });

  it('returns the source it read even when nothing was annotated', () => {
    // This loader replaces the default one; declining would leave the module
    // empty rather than unannotated.
    expect(load('/src/pages/plain.astro', '<h1>Hello</h1>')?.code).toBe('<h1>Hello</h1>');
  });

  it('reports refusals to the caller rather than to a log nobody reads', () => {
    const seen: string[] = [];
    const reporting = livePreviewAnnotate({
      ...options,
      readFile: () => '<h1>Hello {page.title}</h1>',
      onRefusals: (file, refusals) => seen.push(`${file}:${String(refusals.length)}`),
    });

    reporting.load('/src/pages/a.astro');

    expect(seen).toEqual(['/src/pages/a.astro:1']);
  });

  it('runs before the framework compiler', () => {
    expect(livePreviewAnnotate(options).enforce).toBe('pre');
  });
});

/** The recorded majors, restated so the suite's shape is static; held equal below. */
const MAJORS = [5, 6, 7, 8];

describe('the Vite majors it has to work on', () => {
  const matrix = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../../quality/compat-matrix.json'), 'utf8'),
  ) as { frameworks: readonly { tested: readonly { vite?: string }[] }[] };
  const recorded = [
    ...new Set(
      matrix.frameworks.flatMap((framework) =>
        framework.tested.flatMap((entry) => (entry.vite === undefined ? [] : majorsIn(entry.vite))),
      ),
    ),
  ].sort((left, right) => left - right);

  it('is exactly what the record says, so the cases below cannot drift from it', () => {
    // The cases are a literal, because the test policy wants a suite whose
    // shape is readable without running it. This is the other half: add or drop
    // a framework major and the record moves, this fails, and the literal is
    // updated deliberately. Nothing diverges quietly.
    expect(recorded).toEqual(MAJORS);
  });

  it('uses only hooks every one of them has', () => {
    // `name`, `enforce` and `load(id)` are the whole surface, and all three
    // predate Vite 5. Not the environment API (6), not the object form of a
    // hook with `filter` (6), nothing Rolldown-only.
    expect(Object.keys(pluginShape()).sort()).toEqual(['enforce', 'load', 'name']);
  });

  it.each(MAJORS)('loads the same way under Vite %i', (major) => {
    // `load` takes an id and returns a string; it has no bundler in it, which
    // is exactly why one call per major is a meaningful test.
    const result = livePreviewAnnotate({ ...options, readFile: () => PAGE }).load(
      `/v${String(major)}/index.astro`,
    );

    expect(result?.code).toContain("{...__lpPreview.bind('title')}");
    expect(result?.map).toBeNull();
  });
});

function pluginShape(): Record<string, unknown> {
  return { ...livePreviewAnnotate(options) };
}
