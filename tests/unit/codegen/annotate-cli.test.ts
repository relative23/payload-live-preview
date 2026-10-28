import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAnnotate, collectTemplates } from '../../../src/codegen/annotate/cli';

/**
 * `pll-codegen annotate` end to end: a real Payload config, real template files
 * on disk, and the two behaviours a codemod is judged by — that it changes
 * nothing until asked, and that its report says what it did not do.
 */

const CONFIG = `
  export default {
    globals: [],
    collections: [
      {
        slug: 'pages',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'subtitle', type: 'text' },
          { name: 'lede', type: 'text' },
        ],
      },
    ],
  };
`;

/** The last line is bound by hand: it is what says `page` holds the document. */
const TEMPLATE = `<article>
  <h1>{page.title}</h1>
  <p>Published {page.subtitle}</p>
  <p>{page.missing}</p>
  <p data-payload-field="lede">{page.lede}</p>
</article>
`;

let workDir: string;
let templatePath: string;
let configPath: string;

function capture(): { out: string[]; err: string[]; io: Parameters<typeof runAnnotate>[1] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pll-annotate-'));
  configPath = join(workDir, 'payload.config.ts');
  await writeFile(configPath, CONFIG, 'utf8');
  await mkdir(join(workDir, 'src'), { recursive: true });
  templatePath = join(workDir, 'src', 'page.astro');
  await writeFile(templatePath, TEMPLATE, 'utf8');
});

describe('pll-codegen annotate', () => {
  it('reports what it would do and changes nothing without --write', async () => {
    const { out, io } = capture();

    const code = await runAnnotate([join(workDir, 'src'), '--config', configPath], io);

    expect(await readFile(templatePath, 'utf8')).toBe(TEMPLATE);
    // Exit 3, not 0: a dry run that found work is not "nothing to do", and a
    // pre-commit hook should be able to tell the two apart.
    expect(code).toBe(3);
    expect(out.join('')).toContain('would annotate 1 element(s); 2 left for a human');
  });

  it('writes the annotations with --write, and finds none the second time', async () => {
    const first = capture();
    expect(await runAnnotate([templatePath, '--config', configPath, '--write'], first.io)).toBe(0);

    const written = await readFile(templatePath, 'utf8');
    expect(written).toContain('<h1 data-payload-field="title">{page.title}</h1>');
    // The two it refused are still exactly as they were.
    expect(written).toContain('<p>Published {page.subtitle}</p>');
    expect(written).toContain('<p>{page.missing}</p>');

    const second = capture();
    expect(await runAnnotate([templatePath, '--config', configPath, '--write'], second.io)).toBe(0);
    expect(second.out.join('')).toContain('annotated 0 element(s)');
  });

  it('names both refusals, with the reason and the line', async () => {
    const { out, io } = capture();

    await runAnnotate([templatePath, '--config', configPath], io);

    const report = out.join('');
    expect(report).toContain('3: left alone — the value is printed beside other content');
    expect(report).toContain('4: left alone — the schema has no field `missing`');
  });

  describe('a config it cannot read', () => {
    // Site audit of 2026-10-27 (A1), on two sites: the schema came back
    // empty, the run exited 0, and every real field was reported as one "the
    // schema has no field" — while the generator stops on the same config
    // with exit 2.
    it('stops with exit 2 when the config does not open, and names it', async () => {
      const { out, err, io } = capture();

      const code = await runAnnotate([templatePath, '--config', join(workDir, 'nope.ts')], io);

      expect(code).toBe(2);
      expect(err.join('')).toContain('Could not open');
      expect(err.join('')).toContain('the schema is empty');
      // Nothing was scanned, so there is no report claiming refusals.
      expect(out.join('')).toBe('');
    });

    it('stops with exit 2 when the collections come through a path alias', async () => {
      await mkdir(join(workDir, 'collections'), { recursive: true });
      await writeFile(
        join(workDir, 'collections', 'Pages.ts'),
        "export const Pages = { slug: 'pages', fields: [{ name: 'title', type: 'text' }] };\n",
        'utf8',
      );
      const aliased = join(workDir, 'aliased.config.ts');
      await writeFile(
        aliased,
        "import { Pages } from '@/collections/Pages';\nexport default { collections: [Pages] };\n",
        'utf8',
      );
      const { err, io } = capture();

      const code = await runAnnotate([templatePath, '--config', aliased, '--write'], io);

      expect(code).toBe(2);
      expect(err.join('')).toContain('Skipped "Pages"');
      expect(err.join('')).toContain('path alias');
      expect(await readFile(templatePath, 'utf8')).toBe(TEMPLATE);
    });
  });

  it('refuses to run without a config or a path', async () => {
    const { err, io } = capture();

    expect(await runAnnotate([templatePath], io)).toBe(1);
    expect(await runAnnotate(['--config', configPath], io)).toBe(1);
    expect(err.join('')).toContain('--config and at least one path are required');
  });
});

describe('collecting templates', () => {
  it('walks a directory and takes only the template extensions', async () => {
    await writeFile(join(workDir, 'src', 'notes.md'), '# not a template', 'utf8');
    await writeFile(join(workDir, 'src', 'Card.tsx'), '<p>{page.title}</p>', 'utf8');
    await mkdir(join(workDir, 'src', 'node_modules'), { recursive: true });
    await writeFile(join(workDir, 'src', 'node_modules', 'dep.astro'), '<p>{a.b}</p>', 'utf8');

    const found = await collectTemplates([join(workDir, 'src')]);

    expect(found.map((path) => path.split('/').pop())).toEqual(['Card.tsx', 'page.astro']);
  });
});
