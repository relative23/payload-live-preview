import { describe, expect, it } from 'vitest';
import { annotateTemplates, type AnnotationRefusal } from '../../../src/codegen/annotate/index';
import type { PreviewInventory } from '../../../src/codegen/inventory';

/**
 * The places `pll-codegen annotate` must leave alone, from the site audit of
 * 2026-10-27: four sites, 17 suggestions, 16 of them wrong. Each case is a
 * shape one of those templates had. A refusal costs an editor one invisible
 * edit; each of these, written with `--write`, would have made the runtime
 * write a value into an element that shows something else.
 */

const field = (path: string): PreviewInventory['collections'][number]['fields'][number] => ({
  path,
  kind: 'scalar',
  localized: false,
  required: false,
});

const INVENTORY: PreviewInventory = {
  globals: [
    { slug: 'settings', typeName: 'Setting', fields: ['tagline', 'contact.email'].map(field) },
  ],
  collections: [
    {
      slug: 'pages',
      typeName: 'Page',
      fields: ['title', 'subtitle', 'email', 'hero.eyebrow'].map(field),
    },
    { slug: 'posts', typeName: 'Post', fields: ['title', 'excerpt'].map(field) },
    { slug: 'media', typeName: 'Media', fields: ['caption', 'alt'].map(field) },
  ],
};

interface Outcome {
  readonly bound: readonly string[];
  readonly refusals: readonly AnnotationRefusal[];
}

async function annotate(
  source: string,
  file = '/site/src/components/Card.astro',
): Promise<Outcome> {
  const result = await annotateTemplates({
    files: [file],
    inventory: INVENTORY,
    cwd: '/site',
    io: {
      read: () => Promise.resolve(source),
      write: () => Promise.reject(new Error('a dry run writes nothing')),
    },
  });
  const [only] = result.files;
  return {
    bound: only?.annotations.map((annotation) => annotation.path) ?? [],
    refusals: only?.refusals ?? [],
  };
}

const reasons = (outcome: Outcome): readonly string[] =>
  outcome.refusals.map((refusal) => refusal.reason);

/** The hand binding that tells the scan `page` holds the previewed document. */
const PAGE_ANCHOR = '<h1 data-payload-field="title">{page.title}</h1>';

describe('a field of a variable nothing in the file ties to the previewed document', () => {
  // A2: a post card, an event row, a menu card, a media figure and a press
  // page on three sites. The scan dropped the root variable and matched what
  // was left against every collection and global at once, so a card's
  // `post.title` became the page's `title`.
  it.each([
    [
      'a card printing another document',
      '<article><h2>{post.title}</h2><p>{post.excerpt}</p></article>',
    ],
    ['a footer printing a global', '<footer><p>{settings.tagline}</p></footer>'],
    [
      'a figure printing a media document',
      '<figure><figcaption>{media.caption}</figcaption></figure>',
    ],
  ])('is refused in %s', async (_label, template) => {
    const outcome = await annotate(template);

    expect(outcome.bound).toEqual([]);
    expect(reasons(outcome).length).toBeGreaterThan(0);
    for (const reason of reasons(outcome)) {
      expect(reason).toContain('binds no field of');
    }
  });

  it('binds the rest of a variable the file already binds by hand, and nothing of another', async () => {
    const outcome = await annotate(
      `${PAGE_ANCHOR}\n<p>{page.subtitle}</p>\n<p>{settings.tagline}</p>`,
    );

    expect(outcome.bound).toEqual(['subtitle']);
    expect(reasons(outcome)).toEqual([expect.stringContaining('binds no field of `settings`')]);
  });

  it('refuses a path the bound variable’s collection does not have, even if another one does', async () => {
    // `hero.eyebrow` is a field of `pages` only, so `page` holds a page; that
    // `posts` has an `excerpt` says nothing about this variable.
    const outcome = await annotate(
      '<p data-payload-field="hero.eyebrow">{page.hero.eyebrow}</p>\n<p>{page.excerpt}</p>',
    );

    expect(outcome.bound).toEqual([]);
    expect(reasons(outcome)).toEqual([expect.stringContaining('no single collection or global')]);
  });
});

describe('a link', () => {
  // A5: a `tel:` link and a `mailto:` footer link. An `<a>` binding is a
  // `url` binding, which writes the value into `href` too, so `mailto:` or the
  // link's own target would be lost on the first message.
  it('is refused, with the reason', async () => {
    const outcome = await annotate(
      `${PAGE_ANCHOR}\n<a href={\`mailto:\${page.email}\`}>{page.email}</a>`,
    );

    expect(outcome.bound).toEqual([]);
    expect(reasons(outcome)).toEqual([expect.stringContaining('writes the value into `href`')]);
  });
});

describe('a binding written as a spread', () => {
  // A6: a hero and an info card on two sites. The gated helper's spread was
  // not seen as a binding, so the scan proposed a second, ungated
  // `data-payload-field` beside it — on every public response.
  it.each([
    ['the gated helper', "<h1 {...preview.bind('title')}>{page.title}</h1>"],
    ['the typed form', "<h1 {...preview.bind<Page>('title')}>{page.title}</h1>"],
    ['the ungated helper', '<h1 {...bind<Page>("title")}>{page.title}</h1>'],
    [
      'a path recorded through a proxy',
      '<h1 {...bindByPath<Page>((d) => d.title)}>{page.title}</h1>',
    ],
  ])('is left as it is when it comes from %s', async (_label, template) => {
    const outcome = await annotate(template);

    expect(outcome.bound).toEqual([]);
    expect(outcome.refusals).toEqual([]);
  });

  it('ties the variable to the document like a hand-written attribute does', async () => {
    const outcome = await annotate(
      "<h1 {...preview.bind('title')}>{page.title}</h1>\n<p>{page.subtitle}</p>",
    );

    expect(outcome.bound).toEqual(['subtitle']);
  });

  it('is refused when the scan cannot read what the spread holds', async () => {
    const outcome = await annotate(`${PAGE_ANCHOR}\n<p {...rest}>{page.subtitle}</p>`);

    expect(outcome.bound).toEqual([]);
    expect(reasons(outcome)).toEqual([expect.stringContaining('spreads attributes')]);
  });
});

describe('code that is not template', () => {
  // A3: 19 report lines on two sites about the content of `<script>` and
  // `<style>` blocks, a layout's and a section's among them.
  it.each([
    ['a script', "<script>\n  import { boot } from './boot';\n  boot({ page });\n</script>"],
    ['a style sheet', '<style>\n  h1 { color: red; }\n</style>'],
    [
      'an Astro style with variables',
      '<style define:vars={{ accent }}>\n  h1 { color: var(--accent); }\n</style>',
    ],
  ])('is not read in %s', async (_label, block) => {
    const outcome = await annotate(`${PAGE_ANCHOR}\n${block}`);

    expect(outcome.refusals).toEqual([]);
  });

  it.each([
    ['a string in a script', "<script>el.innerHTML = '<b>{page.subtitle}</b>';</script>"],
    ['a comment', '<!-- <p>{page.subtitle}</p> -->'],
    ['Astro frontmatter', "---\nconst sample = '<p>{page.subtitle}</p>';\n---"],
  ])('is never annotated in %s', async (_label, block) => {
    // The plugin has always skipped frontmatter; the codemod read it, so the
    // two routes did not decide the same way.
    const source = block.startsWith('---')
      ? `${block}\n${PAGE_ANCHOR}`
      : `${PAGE_ANCHOR}\n${block}`;

    const outcome = await annotate(source);

    expect(outcome.bound).toEqual([]);
  });
});

describe('the document title', () => {
  // A4: a head component's `<title>{page.title}</title>` became `title`. The
  // head belongs to the route strategy, and the title there is usually the
  // field plus a suffix the template adds elsewhere.
  it.each([
    [
      'in the head',
      `<html><head><title>{page.title}</title></head><body>${PAGE_ANCHOR}</body></html>`,
    ],
    ['in a head component', `<title>{page.title}</title>\n<meta name="x" />\n${PAGE_ANCHOR}`],
  ])('is refused %s', async (_label, template) => {
    const outcome = await annotate(template);

    expect(outcome.bound).toEqual([]);
    expect(reasons(outcome)).toEqual([expect.stringContaining('`<title>`')]);
  });
});
