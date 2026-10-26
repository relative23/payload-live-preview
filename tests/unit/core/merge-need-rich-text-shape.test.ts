/**
 * The merge decision reads a rich-text value the way the writer does: by its
 * shape. Payload 3's admin posts the nodes inside rich text as bare IDs, and the
 * writer renders a Lexical root as rich text whatever the element declares. A
 * page that marked its element only with `data-payload-field` was therefore
 * written from the bare IDs and never asked the server to fill them, so the
 * image inside the text was gone with the first edit (measured on the demo,
 * Payload 3.90.2, 2026-10-17).
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { FieldRenderer } from '@core/types';
import { buildBuiltinRenderers } from '@field-types/index';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

const SERVER = 'https://cms.example.com';

const intro = {
  type: 'paragraph',
  version: 1,
  children: [{ type: 'text', version: 1, text: 'Intro' }],
};

function lexical(...children: unknown[]): unknown {
  return { root: { type: 'root', version: 1, children: [intro, ...children] } };
}

const upload = (value: unknown) => ({
  type: 'upload',
  version: 3,
  relationTo: 'media',
  value,
  fields: null,
});

const image = {
  id: 16,
  url: `${SERVER}/api/media/file/a.jpg`,
  filename: 'a.jpg',
  mimeType: 'image/jpeg',
  alt: 'A',
  width: 2200,
  height: 1300,
};

function answering(content: unknown): Mock<typeof fetch> {
  return vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'post-1', content }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

async function edit(fetchFn: Mock<typeof fetch>, markup: string, ...contents: unknown[]) {
  document.body.innerHTML = markup;
  const runtime = makeRuntime({
    renderers: buildBuiltinRenderers(),
    dataMerge: { serverURL: SERVER, fetchFn },
  });
  runtime.start();
  for (const content of contents) {
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: 'post-1', content },
    });
    await vi.advanceTimersByTimeAsync(50);
  }
  return runtime;
}

const UNDECLARED = '<div data-payload-field="content"></div>';

describe('a rich-text value on an element that declares no type', () => {
  it('asks the server to fill an upload node, and draws the image it returns', async () => {
    const fetchFn = answering(lexical(upload(image)));
    const runtime = await edit(fetchFn, UNDECLARED, lexical(upload(16)));

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-payload-field="content"] img')?.getAttribute('src')).toBe(
      image.url,
    );
    runtime.destroy();
  });

  it.each([
    ['a relationship node', { type: 'relationship', version: 2, relationTo: 'posts', value: 7 }],
    [
      'an internal link',
      {
        type: 'link',
        version: 3,
        fields: { linkType: 'internal', doc: { relationTo: 'posts', value: 7 } },
        children: [{ type: 'text', version: 1, text: 'see' }],
      },
    ],
    ['a block', { type: 'block', version: 2, fields: { blockType: 'cta', id: 'b1' } }],
    ['a node this package does not know', { type: 'x-custom', version: 1 }],
  ])('asks for %s the same way', async (_name, node) => {
    const fetchFn = answering(lexical(node));
    const runtime = await edit(fetchFn, UNDECLARED, lexical(node));

    expect(fetchFn).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('asks nothing for rich text whose nodes hold nothing to resolve', async () => {
    const fetchFn = answering(null);
    const text = (value: string) => ({ type: 'text', version: 1, text: value });
    // Every node type that carries its whole content.
    const plain = lexical(
      { type: 'heading', version: 1, tag: 'h2', children: [text('Title')] },
      { type: 'quote', version: 1, children: [text('said')] },
      {
        type: 'list',
        version: 1,
        listType: 'bullet',
        children: [{ type: 'listitem', version: 1, children: [text('one')] }],
      },
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'link',
            version: 3,
            fields: { linkType: 'custom', url: 'https://example.com' },
            children: [text('out')],
          },
          { type: 'autolink', version: 1, fields: { linkType: 'custom' }, children: [text('www')] },
          { type: 'linebreak', version: 1 },
          { type: 'tab', version: 1, text: '\t' },
        ],
      },
      { type: 'horizontalrule', version: 1 },
      { type: 'code', version: 1, children: [{ type: 'code-highlight', version: 1, text: 'x' }] },
      {
        type: 'table',
        version: 1,
        children: [
          {
            type: 'tablerow',
            version: 1,
            children: [{ type: 'tablecell', version: 1, children: [] }],
          },
        ],
      },
    );
    const runtime = await edit(fetchFn, UNDECLARED, plain, plain);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('[data-payload-field="content"]')?.textContent).toContain(
      'Intro',
    );
    runtime.destroy();
  });

  it('passes over an entry that is not a node', async () => {
    // Only the decision is read here: the renderer is not built for such a tree.
    const fetchFn = answering(null);
    const stray = lexical({ type: 'paragraph', version: 1, children: [null, 'stray'] });
    const runtime = await edit(fetchFn, UNDECLARED, stray, stray);

    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('asks nothing for an element whose markup names another type', async () => {
    // `<time>` reads as a date; only the default `text` goes by the value's shape.
    const fetchFn = answering(lexical(upload(image)));
    const runtime = await edit(
      fetchFn,
      '<time data-payload-field="content"></time>',
      lexical(upload(16)),
    );

    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('asks once a later message puts an upload into text that held none', async () => {
    const fetchFn = answering(lexical(upload(image)));
    const runtime = await edit(fetchFn, UNDECLARED, lexical(), lexical(upload(16)));

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-payload-field="content"] img')?.getAttribute('src')).toBe(
      image.url,
    );
    runtime.destroy();
  });

  it('asks nothing for an element that declares itself plain text', async () => {
    // `data-payload-type="text"` is written as plain text; nothing populated is drawn.
    const fetchFn = answering(lexical(upload(image)));
    const runtime = await edit(
      fetchFn,
      '<div data-payload-field="content" data-payload-type="text"></div>',
      lexical(upload(16)),
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('[data-payload-field="content"]')?.textContent).toBe('Intro');
    runtime.destroy();
  });

  it("reads the value in the binding's own locale, as the writer does", async () => {
    const english = lexical();
    const fetchFn = answering(null);
    fetchFn.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'post-1', content: english, content_de: lexical(upload(image)) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    document.body.innerHTML = '<div data-payload-field="content" data-payload-locale="de"></div>';
    const runtime = makeRuntime({
      renderers: buildBuiltinRenderers(),
      dataMerge: { serverURL: SERVER, fetchFn },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      locale: 'en',
      data: { id: 'post-1', content: english, content_de: lexical(upload(16)) },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-payload-field="content"] img')?.getAttribute('src')).toBe(
      image.url,
    );
    runtime.destroy();
  });

  it('walks a node once, so a cycle the structured clone kept ends the walk', async () => {
    // A getter stands in for the cycle, so a walk that never ends fails instead of hanging.
    let visits = 0;
    const node: Record<string, unknown> = { type: 'paragraph', version: 1 };
    Object.defineProperty(node, 'children', {
      enumerable: true,
      get() {
        visits += 1;
        if (visits > 1000) throw new Error('the walk did not end');
        return [node];
      },
    });
    const fetchFn = answering(null);
    document.body.innerHTML = UNDECLARED;
    // A renderer that does not walk the tree, so the count is the decision's own.
    const richText: FieldRenderer = { name: 'richText', render: () => undefined };
    const runtime = makeRuntime({
      renderers: { ...buildBuiltinRenderers(), richText },
      dataMerge: { serverURL: SERVER, fetchFn },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: 'post-1', content: { root: { type: 'root', version: 1, children: [node] } } },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(visits).toBeLessThan(10);
    expect(fetchFn).not.toHaveBeenCalled();
    runtime.destroy();
  });
});
