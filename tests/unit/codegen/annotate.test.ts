import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  annotatablePaths,
  annotateTemplates,
  formatAnnotateReport,
} from '../../../src/codegen/annotate/index';
import { scanTemplate } from '../../../src/codegen/annotate/scan';
import type { PreviewInventory } from '../../../src/codegen/inventory';

/**
 * The annotator's contract is what it *refuses*. Adding `data-payload-field`
 * where a template prints a field saves an afternoon; adding one where the tool
 * only guessed writes a value into the wrong element on every keystroke, and
 * nobody looks for that in a diff they asked a codemod to produce.
 *
 * The fixture is therefore read twice: once for what it annotates, once for the
 * list of places it deliberately leaves to a human.
 */

const FIXTURE = resolve('tests/fixtures/annotate/page.astro');

const INVENTORY: PreviewInventory = {
  globals: [],
  collections: [
    {
      slug: 'pages',
      typeName: 'Page',
      fields: [
        { path: 'title', kind: 'scalar', localized: false, required: true },
        { path: 'subtitle', kind: 'scalar', localized: false, required: false },
        { path: 'body', kind: 'scalar', localized: false, required: false },
        { path: 'publishedAt', kind: 'scalar', localized: false, required: false },
        { path: 'hero', kind: 'group', localized: false, required: false },
        { path: 'hero.eyebrow', kind: 'scalar', localized: false, required: false },
        { path: 'slides', kind: 'array', localized: false, required: false },
        { path: 'slides.*.caption', kind: 'scalar', localized: false, required: false },
      ],
    },
  ],
};

async function run(write = false): Promise<{
  code: string;
  annotated: readonly string[];
  refusals: readonly string[];
  report: string;
}> {
  const written: Record<string, string> = {};
  const result = await annotateTemplates({
    files: [FIXTURE],
    inventory: INVENTORY,
    write,
    io: {
      read: (path) => readFile(path, 'utf8'),
      write: (path, content) => {
        written[path] = content;
        return Promise.resolve();
      },
    },
  });
  const file = result.files[0];
  expect(file).toBeDefined();
  if (write) expect(Object.keys(written)).toEqual([FIXTURE]);
  else expect(written).toEqual({});
  return {
    code: file?.code ?? '',
    annotated: file?.annotations.map((entry) => entry.path) ?? [],
    refusals: file?.refusals.map((entry) => entry.reason) ?? [],
    report: formatAnnotateReport(result),
  };
}

describe('annotating a template', () => {
  it('binds every element whose whole content is one known field', async () => {
    const { code, annotated } = await run();

    expect(annotated).toEqual(['title', 'subtitle', 'hero.eyebrow']);
    expect(code).toContain('<h1 data-payload-field="title">{page.title}</h1>');
    expect(code).toContain('<p data-payload-field="subtitle" class="lede">{page.subtitle}</p>');
    expect(code).toContain('<p data-payload-field="hero.eyebrow">{page.hero.eyebrow}</p>');
  });

  it('leaves everything it would have to guess, and says why', async () => {
    const { refusals, code } = await run();

    expect(refusals).toEqual([
      // `Published {page.publishedAt}` — a binding would replace the label too.
      'the value is printed beside other content — a binding replaces the whole text, so the markup has to be split first',
      // `{formatDate(page.publishedAt)}` — derived, no single field to name.
      'not a plain field access — a call, an operator or an index cannot be traced to one field',
      // `{page.internalNote}` — the schema has no such field.
      'the schema has no field `internalNote`; the binding would name something that never arrives',
      // `{slide.caption}` in a loop — nothing connects `slide` to `slides`.
      'the schema has no field `caption`; the binding would name something that never arrives',
    ]);
    // The component keeps its props, and the hand-written binding is untouched.
    expect(code).toContain('<Hero title={page.title} />');
    expect(code).toContain('<p data-payload-field="body">{page.body}</p>');
    expect(code).not.toContain('data-payload-field="publishedAt"');
  });

  it('writes nothing without `write`, and exactly the annotated source with it', async () => {
    const dry = await run(false);
    const wet = await run(true);

    expect(wet.code).toBe(dry.code);
    expect(dry.report).toContain('would annotate 3 element(s); 4 left for a human');
    expect(wet.report).toContain('annotated 3 element(s); 4 left for a human');
  });

  it('is idempotent: the annotated file has nothing left to add', async () => {
    const { code } = await run();

    const second = scanTemplate(code, { paths: annotatablePaths(INVENTORY) });

    expect(second.candidates).toEqual([]);
  });
});

describe('the paths it will bind', () => {
  it('excludes array item paths, which no template can name', () => {
    // `slides.*.caption` is how the runtime resolves an item; a template says
    // `slide.caption` inside a loop, and the two only look alike.
    expect(annotatablePaths(INVENTORY).has('slides.*.caption')).toBe(false);
    expect(annotatablePaths(INVENTORY).has('hero.eyebrow')).toBe(true);
  });
});

describe('the shapes the scanner accepts', () => {
  const paths = new Set(['title']);

  it('takes the same shape in JSX and Svelte as in Astro', () => {
    for (const source of ['<h1>{page.title}</h1>', '<h1>{ data.title }</h1>']) {
      expect(scanTemplate(source, { paths }).candidates).toHaveLength(1);
    }
  });

  it('refuses an uppercase tag, whose children belong to the component', () => {
    expect(scanTemplate('<Title>{page.title}</Title>', { paths }).candidates).toEqual([]);
  });

  it('refuses a bare identifier, which names no document', () => {
    const result = scanTemplate('<h1>{title}</h1>', { paths });

    expect(result.candidates).toEqual([]);
    expect(result.refusals[0]?.reason).toContain('not a plain field access');
  });
});
